'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const mini = path.join(root, 'miniprogram');
const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'));
const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const failures = [];
const fail = message => failures.push(message);
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
const files = walk(mini);
if (project.miniprogramRoot !== 'miniprogram/') fail('Incorrect miniprogramRoot');
if (!app.resizable) fail('Desktop resize must be enabled');
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.js')) {
    try { new vm.Script(content, { filename: file }); } catch (error) { fail(error.message); }
    for (const match of content.matchAll(/require\(['"]([.][^'"]+)['"]\)/g)) {
      const dependency = path.resolve(path.dirname(file), match[1]);
      if (![dependency, dependency + '.js', dependency + '.json', path.join(dependency, 'index.js')].some(file => fs.existsSync(file))) fail('Missing module: ' + dependency);
    }
  }
  if (file.endsWith('.json')) { try { JSON.parse(content); } catch (error) { fail(file + ': ' + error.message); } }
  if (file.endsWith('.wxml') && /<\/?(?:div|span|img|a|form-input)\b/.test(content)) fail('HTML tag in WXML: ' + file);
}
for (const route of app.pages) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) if (!fs.existsSync(path.join(mini, route + '.' + extension))) fail('Missing page file: ' + route + '.' + extension);
  const js = path.join(mini, route + '.js'), wxml = path.join(mini, route + '.wxml');
  if (!fs.existsSync(js) || !fs.existsSync(wxml)) continue;
  let definition;
  const sandbox = { Page(value) { definition = value; }, require(name) { return require(path.resolve(path.dirname(js), name)); } };
  try { vm.runInNewContext(fs.readFileSync(js, 'utf8'), sandbox); }
  catch (error) { fail(route + ': ' + error.message); continue; }
  for (const match of fs.readFileSync(wxml, 'utf8').matchAll(/(?:bind|catch)(?::)?[a-z]+="([a-zA-Z_$][\w$]*)"/g)) {
    if (!definition || typeof definition[match[1]] !== 'function') fail(route + ': missing event handler ' + match[1]);
  }
}
for (const tab of app.tabBar.list) {
  if (!app.pages.includes(tab.pagePath)) fail('Unknown tab route: ' + tab.pagePath);
  for (const key of ['iconPath', 'selectedIconPath']) if (!fs.existsSync(path.join(mini, tab[key]))) fail('Missing tab icon: ' + tab[key]);
}
const garden = require(path.join(mini, 'data/garden'));
for (const section of garden) for (const photo of section.photos) if (!fs.existsSync(path.join(root, photo.path.slice(1)))) fail('Missing garden image: ' + photo.path);
const bytes = files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
if (bytes > 2 * 1024 * 1024) fail('Source package exceeds conservative 2 MiB budget');
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('OK: ' + app.pages.length + ' pages, JS/JSON syntax, modules, WXML handlers, routes, assets; source ' + (bytes / 1024).toFixed(1) + ' KiB');
console.log('This is a structural check, not a replacement for WeChat Developer Tools or device QA.');
