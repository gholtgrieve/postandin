import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {dirname,extname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

function htmlFiles(directory){
  const files=[];
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    if(entry.name==='.git'||entry.name==='node_modules')continue;
    const path=join(directory,entry.name);
    if(entry.isDirectory())files.push(...htmlFiles(path));
    else if(extname(entry.name)==='.html')files.push(path);
  }
  return files;
}

test('every static page uses the Post & In font system',()=>{
  for(const path of htmlFiles(root)){
    const html=readFileSync(path,'utf8');
    const label=relative(root,path);
    assert.match(html,/fonts\.googleapis\.com\/css2\?family=Bebas\+Neue(?:&amp;|&)family=IBM\+Plex\+Mono:wght@400;500;700(?:&amp;|&)display=swap/,`${label} must load the standard fonts and weights`);
    const localStyles=[...html.matchAll(/<link[^>]+href="(?!https?:\/\/)([^"?#]+\.css)[^>]*>/g)].map(match=>readFileSync(match[1].startsWith('/')?resolve(root,match[1].slice(1)):resolve(dirname(path),match[1]),'utf8'));
    const styles=[html,...localStyles].join('\n');
    assert.match(styles,/font(?:-family|\s*:)[^;}]*['"]?Bebas Neue/i,`${label} must use Bebas Neue for display type`);
    assert.match(styles,/font(?:-family|\s*:)[^;}]*['"]?IBM Plex Mono/i,`${label} must use IBM Plex Mono for body and UI type`);
  }
});
