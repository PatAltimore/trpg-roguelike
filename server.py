"""Dev server with cache-busting headers for ES modules."""
import http.server, os, pathlib

# Always serve from the project directory
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

http.server.HTTPServer(('', 8080), NoCacheHandler).serve_forever()
