#!/usr/bin/env python3
"""Loopback-only public key endpoint for the private Automation backend."""
import argparse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, required=True)
parser.add_argument('--jwks', required=True)
args = parser.parse_args()
data = Path(args.jwks).read_bytes()

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/api/auth/convex-jwks':
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args):
        pass

HTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
