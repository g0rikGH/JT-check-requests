import Database from 'better-sqlite3';
const db = new Database('database.sqlite');

const latestTask = db.prepare('SELECT id FROM tasks ORDER BY id DESC LIMIT 1').get();
const refItem = db.prepare(`
  SELECT * FROM reference_items WHERE task_id = ? AND article_norm = '044270K063'
`).get(latestTask.id);
console.log("Reference Item for 044270K063:", refItem);
