#!/usr/bin/env python3
"""Expose the local Studio workshop database only on its private worker bridge."""
import asyncio
import contextlib
import ipaddress

NETWORK = ipaddress.ip_network('172.30.240.0/24')
HOST = '172.30.240.1'
PORT = 39403
MAX_CONNECTIONS = 64
active = 0

async def copy(reader, writer):
    while data := await reader.read(65536):
        writer.write(data)
        await writer.drain()

async def serve(reader, writer):
    global active
    peer = writer.get_extra_info('peername')
    if not peer or ipaddress.ip_address(peer[0]) not in NETWORK or active >= MAX_CONNECTIONS:
        writer.close()
        await writer.wait_closed()
        return
    active += 1
    upstream = None
    try:
        upstream_reader, upstream = await asyncio.wait_for(asyncio.open_connection('127.0.0.1',39420),timeout=5)
        tasks = [asyncio.create_task(copy(reader,upstream)), asyncio.create_task(copy(upstream_reader,writer))]
        _done, pending = await asyncio.wait(tasks,return_when=asyncio.FIRST_COMPLETED)
        for task in pending: task.cancel()
        await asyncio.gather(*tasks,return_exceptions=True)
    except (OSError, asyncio.TimeoutError):
        pass
    finally:
        try:
            if upstream:
                upstream.close()
                with contextlib.suppress(OSError):
                    await upstream.wait_closed()
            writer.close()
            with contextlib.suppress(OSError):
                await writer.wait_closed()
        finally:
            active -= 1

async def main():
    server = await asyncio.start_server(serve,HOST,PORT,limit=131072)
    async with server: await server.serve_forever()

asyncio.run(main())
