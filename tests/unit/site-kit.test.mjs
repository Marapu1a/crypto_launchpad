import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validate,footer,safeLink} from '../../src/site-kit/render.mjs';
const config=JSON.parse(await readFile('tokens/QIANQI/site.config.json','utf8'));
test('site configuration rejects unsafe assets and broken legacy program selections',()=>{
 assert.equal(validate(structuredClone(config)).project,'qianqi');
 for(const src of ['/assets/../secret','javascript:alert(1)','//external.test/a.png','/assets/x".png']){const c=structuredClone(config);c.art.hero.src=src;assert.throws(()=>validate(c));}
 const c=structuredClone(config);c.draws.pop();assert.throws(()=>validate(c));
 const huge=structuredClone(config);huge.footer.mascotWidth=2000;assert.throws(()=>validate(huge));
});
test('footer escapes text and rejects executable contact links',()=>{
 const project={name:'<script>bad</script>',symbol:'A&B',creatorTelegram:'https://t.me/example'};
 const catalog={hub:'https://example.com/',authorX:'https://x.com/example'};
 const html=footer(project,config,catalog);assert.ok(html.includes('A&amp;B'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
 assert.throws(()=>safeLink('javascript:alert(1)'));assert.throws(()=>safeLink('//example.com'));
});
