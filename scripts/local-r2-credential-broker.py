#!/usr/bin/env python3
"""Issue cached, bucket-scoped R2 credentials to the private Automation runtime."""
import asyncio
import hmac
import ipaddress
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request

NETWORK = ipaddress.ip_network('172.30.240.0/24')
ADDRESSES = ('127.0.0.1', '172.30.240.1')
PORT = 39404
TTL = 14400
MAX_ACTIVE = 32
active = 0
cached = None
lock = asyncio.Lock()

def load_config():
    path = Path(os.environ['CREDENTIALS_DIRECTORY']) / 'broker.json'
    data = json.loads(path.read_text())
    required = ('apiToken', 'parentAccessKeyId', 'accountId', 'brokerToken')
    if any(not isinstance(data.get(key), str) or not data[key] for key in required):
        raise RuntimeError('Broker credential configuration is incomplete')
    if not all(c in '0123456789abcdef' for c in data['accountId'].lower()) or len(data['accountId']) != 32:
        raise RuntimeError('Broker account identifier is invalid')
    return data

CONFIG = load_config()

def request_credential():
    body = json.dumps({'bucket': 'youtube-automation', 'parentAccessKeyId': CONFIG['parentAccessKeyId'],
                       'permission': 'object-read-write', 'ttlSeconds': TTL}).encode()
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{CONFIG['accountId']}/r2/temp-access-credentials",
        data=body, method='POST', headers={'Authorization': 'Bearer ' + CONFIG['apiToken'],
                                          'Content-Type': 'application/json'})
    issued_at = time.time()
    with urllib.request.urlopen(req, timeout=10) as response:
        data = json.load(response)
    result = data.get('result') or {}
    if not data.get('success') or any(not isinstance(result.get(k), str) or not result[k]
                                     for k in ('accessKeyId', 'secretAccessKey', 'sessionToken')):
        raise RuntimeError('Scoped credential response was incomplete')
    return {key: result[key] for key in ('accessKeyId', 'secretAccessKey', 'sessionToken')} | {
        'expiresAt': int((issued_at + TTL - 60) * 1000),
    }

async def credential():
    global cached
    async with lock:
        if not cached or cached['expiresAt'] <= int((time.time() + 7200) * 1000):
            cached = await asyncio.to_thread(request_credential)
        return cached

async def serve(reader, writer):
    global active
    peer = writer.get_extra_info('peername')
    status, payload = 403, {'error': 'forbidden'}
    admitted = False
    try:
        if not peer or not (peer[0] == '127.0.0.1' or ipaddress.ip_address(peer[0]) in NETWORK) or active >= MAX_ACTIVE:
            return
        active += 1
        admitted = True
        raw = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), timeout=5)
        lines = raw.decode('iso-8859-1').split('\r\n')
        headers = [line.partition(':') for line in lines[1:] if ':' in line]
        auth = [v.strip() for k, _, v in headers if k.lower() == 'authorization']
        lengths = [v.strip() for k, _, v in headers if k.lower() == 'content-length']
        if lines[0] != 'GET /v1/credentials HTTP/1.1' or len(auth) > 1 or lengths not in ([], ['0']):
            status, payload = 400, {'error': 'invalid request'}
        elif not auth or not hmac.compare_digest(auth[0], 'Bearer ' + CONFIG['brokerToken']):
            status, payload = 401, {'error': 'authentication required'}
        else:
            try:
                payload = await credential()
                status = 200
            except Exception:
                status, payload = 503, {'error': 'scoped storage credentials unavailable'}
    except (asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError, UnicodeError, ValueError):
        status, payload = 400, {'error': 'invalid request'}
    finally:
        if admitted:
            active -= 1
            body = json.dumps(payload, separators=(',', ':')).encode()
            try:
                writer.write(f'HTTP/1.1 {status} Result\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n'.encode() + body)
                await writer.drain()
            except (OSError, ConnectionError):
                pass
        writer.close()
        try:
            await writer.wait_closed()
        except OSError:
            pass

async def main():
    servers = [await asyncio.start_server(serve, address, PORT, limit=8192) for address in ADDRESSES]
    await asyncio.gather(*(server.serve_forever() for server in servers))

if __name__ == '__main__':
    asyncio.run(main())
