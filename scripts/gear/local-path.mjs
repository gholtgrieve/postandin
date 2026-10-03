import { lstatSync, statSync, realpathSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
// Compare filesystem identity, not path spelling (case and symlink safe).
export function safeDatabasePath(path,root=fileURLToPath(new URL('../../',import.meta.url))) {
  if(!isAbsolute(path))throw new Error('Supply an absolute database path outside the website directory.');
  const entry=lstatSync(path,{throwIfNoEntry:false});
  if(entry?.isSymbolicLink())throw new Error('Database file must not be a symbolic link.');
  if(entry && entry.nlink>1)throw new Error('Database file must not have hard links.');
  const actual=existsSync(path)?realpathSync(path):resolve(realpathSync(dirname(path)),basename(path));
  const rootStat=statSync(root);
  for(let dir=dirname(actual);;dir=dirname(dir)){
    const info=statSync(dir);
    if(info.dev===rootStat.dev&&info.ino===rootStat.ino)throw new Error('Database must be outside the website directory.');
    if(dirname(dir)===dir)break;
  }
  if(existsSync(actual)&&!statSync(actual).isFile())throw new Error('Database path must be a file.');
  return actual;
}
