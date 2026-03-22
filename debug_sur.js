import Database from 'better-sqlite3';
const db = new Database('database.sqlite');

const latestTask = db.prepare('SELECT id FROM tasks ORDER BY id DESC LIMIT 1').get();
console.log("Latest Task ID:", latestTask.id);

const suppliers = db.prepare('SELECT * FROM suppliers').all();
console.log("Suppliers:", suppliers);

const surSupplier = suppliers.find(s => s.name.includes('SUR'));
if (surSupplier) {
  console.log("SUR Supplier ID:", surSupplier.id);
  
  const surOffers = db.prepare(`
    SELECT o.*, p.article_norm as part_article_norm, p.brand as part_brand
    FROM offers o
    JOIN parts p ON o.part_id = p.id
    WHERE o.task_id = ? AND o.supplier_id = ?
    LIMIT 10
  `).all(latestTask.id, surSupplier.id);
  console.log("SUR Offers (first 10):", surOffers);

  const refItems = db.prepare(`
    SELECT * FROM reference_items WHERE task_id = ? LIMIT 10
  `).all(latestTask.id);
  console.log("Reference Items (first 10):", refItems);
} else {
  console.log("SUR supplier not found");
}
