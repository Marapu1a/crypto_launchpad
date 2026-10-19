"""Read-only local UI preview. Serves an explicit saved snapshot; never collects data."""
import argparse, http.server, json, pathlib, urllib.parse
ROOT=pathlib.Path(__file__).resolve().parents[1]/'apps'/'monitor'
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--snapshot',required=True,type=pathlib.Path)
parser.add_argument('--port',type=int,default=4217)
args=parser.parse_args()
snapshot=json.loads(args.snapshot.read_text(encoding='utf-8'))
snapshot['preview']=True
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  route=urllib.parse.urlsplit(self.path).path
  if route=='/api/status':
   data=json.dumps(snapshot).encode();mime='application/json'
  else:
   file={'/':'index.html','/wallets':'wallets.html','/ui.js':'ui.js','/ui.css':'ui.css','/tokens.js':'tokens.js','/wallet-ui.js':'wallet-ui.js','/imgs/pw_eye.png':'imgs/pw_eye.png','/imgs/pw_mascot.png':'imgs/pw_mascot.png'}.get(route)
   if not file:self.send_error(404);return
   data=(ROOT/file).read_bytes();mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'}[pathlib.Path(file).suffix]
  self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
 def log_message(self,*args):pass
print(f'Preview: http://127.0.0.1:{args.port} (saved snapshot, no collection)',flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
