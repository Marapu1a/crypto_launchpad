// Preserve old root bookmarks for the first token; the hub uses distinct anchors.
const tokenAnchors = new Set(['account','results','draws','market','how','money','rules','buy','wallet','tickets']);
if (tokenAnchors.has(location.hash.slice(1))) {
  location.replace('https://init.qianqi.site/' + location.search + location.hash);
}
