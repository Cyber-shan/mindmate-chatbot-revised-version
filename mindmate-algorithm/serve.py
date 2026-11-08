"""Local ML service. Safety rules and response policy stay in the Next.js server."""
import argparse
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from distress.model import Classifier


def make_handler(classifier, token=""):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Do not log student text, request bodies, tokens or scores.

        def respond(self, status, data):
            payload = json.dumps(data, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.path != "/health":
                return self.respond(404, {"error": "Not found"})
            self.respond(200, {"ready": classifier is not None, "release_approved": bool(classifier and classifier.artifact["release_approved"])})

        def do_POST(self):
            if self.path != "/predict":
                return self.respond(404, {"error": "Not found"})
            if token and not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {token}"):
                return self.respond(401, {"error": "Unauthorized"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 32768:
                    return self.respond(413, {"error": "Request must be at most 32 KiB"})
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict) or not isinstance(body.get("text"), str) or not body["text"].strip() or len(body["text"]) > 4000:
                    return self.respond(400, {"error": "text must contain between 1 and 4000 characters"})
                if classifier is None:
                    return self.respond(503, {"error": "No trained model configured"})
                self.respond(200, classifier.predict(body["text"]))
            except (ValueError, UnicodeError):
                self.respond(400, {"error": "Invalid request"})
            except Exception:
                self.respond(503, {"error": "Classifier unavailable"})

    return Handler


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    token = os.environ.get("DISTRESS_CLASSIFIER_TOKEN", "")
    if args.host not in ("127.0.0.1", "localhost", "::1") and not token:
        parser.error("A non-local bind requires DISTRESS_CLASSIFIER_TOKEN and a trusted TLS reverse proxy.")
    classifier = Classifier(args.model) if args.model else None
    server = ThreadingHTTPServer((args.host, args.port), make_handler(classifier, token))
    server.timeout = 10
    print(f"Distress classifier listening on {args.host}:{args.port}; model loaded: {bool(classifier)}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
