/* Пересборка js/data/map.js из tools/map.txt (компактный экспорт редактора карты). node tools/build-map.js */
const fs = require('fs'), path = require('path');
const R = { 'Шестая улица': 'Ш', 'Блейзвуд': 'Б', 'Вайфэй': 'В', 'Розкелифер': 'Р', '—': '' };
const cells = [], edges = [], seen = new Set();
for (const l of fs.readFileSync(path.join(__dirname, 'map.txt'), 'utf8').trim().split('\n')) {
  if (l.startsWith('#')) continue;
  const [id, type, reg, xy, nx] = l.split('|'); const [x, y] = xy.split(',').map(Number);
  cells.push({ id, type, region: R[reg], x, y });
  for (let t of nx.split(' ').filter(Boolean)) {
    const both = t.endsWith('↔'); t = t.replace('↔', '');
    if (both) { const k = [id, t].sort().join('-'); if (seen.has(k)) continue; seen.add(k); edges.push([id, t, 1]); } else edges.push([id, t, 0]);
  }
}
fs.writeFileSync(path.join(__dirname, '..', 'js', 'data', 'map.js'), '/* Карта Nexus Party (предварительная). Клетки {id,type,region,x,y}; рёбра [from,to,both]. Сгенерировано tools/build-map.js из tools/map.txt */\nwindow.NP=window.NP||{};\nNP.MAP=' + JSON.stringify({ cells, edges }) + ';\n');
console.log(cells.length, 'клеток,', edges.length, 'связей');
