import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { getDb } from "./db.js";
import multer from "multer";
import xlsx from "xlsx";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Создаем папку для временных файлов
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const upload = multer({ dest: uploadsDir });

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Инициализация БД
  const db = await getDb();

  // Middleware
  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "online", 
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      environment: process.env.NODE_ENV || "development"
    });
  });

  // Получение списка задач
  app.get("/api/tasks", async (req, res) => {
    try {
      const tasks = db.prepare('SELECT * FROM tasks ORDER BY date DESC').all();
      res.json(tasks);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  // Получение конкретной задачи
  app.get("/api/tasks/:id", async (req, res) => {
    try {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
      if (!task) return res.status(404).json({ error: "Task not found" });
      res.json(task);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch task" });
    }
  });

  // Создание новой задачи
  app.post("/api/tasks", async (req, res) => {
    try {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      
      const result = db.prepare('INSERT INTO tasks (name) VALUES (?)').run(name);
      const newTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
      res.json(newTask);
    } catch (err) {
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  // Получение списка поставщиков
  app.get("/api/suppliers", async (req, res) => {
    try {
      const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY name ASC').all();
      res.json(suppliers);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch suppliers" });
    }
  });

  // Добавление поставщика
  app.post("/api/suppliers", async (req, res) => {
    try {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      
      const result = db.prepare('INSERT INTO suppliers (name) VALUES (?)').run(name);
      const newSupplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(result.lastInsertRowid);
      res.json(newSupplier);
    } catch (err) {
      res.status(500).json({ error: "Failed to create supplier" });
    }
  });

  // Удаление поставщика
  app.delete("/api/suppliers/:id", async (req, res) => {
    try {
      db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete supplier" });
    }
  });

  // Обновление поставщика
  app.put("/api/suppliers/:id", async (req, res) => {
    try {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      
      db.prepare('UPDATE suppliers SET name = ? WHERE id = ?').run(name, req.params.id);
      const updatedSupplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
      res.json(updatedSupplier);
    } catch (err) {
      res.status(500).json({ error: "Failed to update supplier" });
    }
  });

  // Получение уникальных брендов из эталона для задачи
  app.get("/api/tasks/:id/brands", async (req, res) => {
    try {
      const brands = db.prepare('SELECT DISTINCT brand FROM reference_items WHERE task_id = ? AND brand IS NOT NULL AND brand != "" ORDER BY brand ASC').all(req.params.id);
      res.json(brands.map((b: any) => b.brand));
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch brands" });
    }
  });

  // Загрузка файла и возврат превью
  app.post("/api/upload-preview", upload.single("file"), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      // Читаем Excel/CSV файл
      const workbook = xlsx.readFile(req.file.path);
      const sheets = workbook.SheetNames;
      const sheetName = req.body.sheetName || sheets[0];
      const sheet = workbook.Sheets[sheetName];
      
      // Получаем данные в виде массива массивов (header: 1)
      const data = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
      
      // Убираем полностью пустые строки
      const nonEmptyData = data.filter(row => row.some(cell => cell !== "" && cell !== null));
      
      if (nonEmptyData.length === 0) {
        return res.status(400).json({ error: "File is empty" });
      }

      // Генерируем заголовки (первая строка или Column 1, Column 2...)
      const headers = nonEmptyData[0].map((h, i) => h ? String(h).trim() : `Колонка ${i + 1}`);
      
      // Берем следующие 5 строк для превью
      const previewRows = nonEmptyData.slice(1, 6).map(row => {
        // Выравниваем длину строки по количеству заголовков
        const paddedRow = [...row];
        while (paddedRow.length < headers.length) paddedRow.push("");
        return paddedRow.slice(0, headers.length);
      });

      res.json({
        fileId: req.file.filename,
        sheets,
        currentSheet: sheetName,
        headers,
        rows: previewRows
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to parse file" });
    }
  });

  app.get("/api/preview/:fileId", (req, res) => {
    try {
      const fileId = req.params.fileId;
      const sheetName = req.query.sheetName as string;
      const filePath = path.join(uploadsDir, fileId);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }

      const workbook = xlsx.readFile(filePath);
      const sheets = workbook.SheetNames;
      const targetSheet = sheetName && sheets.includes(sheetName) ? sheetName : sheets[0];
      const sheet = workbook.Sheets[targetSheet];
      
      const data = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
      const nonEmptyData = data.filter(row => row.some(cell => cell !== "" && cell !== null));
      
      if (nonEmptyData.length === 0) {
        return res.status(400).json({ error: "File is empty" });
      }

      const headers = nonEmptyData[0].map((h, i) => h ? String(h).trim() : `Колонка ${i + 1}`);
      const previewRows = nonEmptyData.slice(1, 6).map(row => {
        const paddedRow = [...row];
        while (paddedRow.length < headers.length) paddedRow.push("");
        return paddedRow.slice(0, headers.length);
      });

      res.json({
        fileId,
        sheets,
        currentSheet: targetSheet,
        headers,
        rows: previewRows
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to parse file" });
    }
  });

  // Обработка файла на основе маппинга
  app.post("/api/tasks/:id/process-file", async (req, res) => {
    try {
      const taskId = req.params.id;
      const { fileId, supplierId, hasVat, mapping, sheetName, defaultBrand } = req.body;

      if (!fileId || !supplierId || !mapping) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const filePath = path.join(uploadsDir, fileId);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }

      // Читаем файл
      const workbook = xlsx.readFile(filePath);
      const targetSheet = sheetName && workbook.SheetNames.includes(sheetName) ? sheetName : workbook.SheetNames[0];
      const sheet = workbook.Sheets[targetSheet];
      const data = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });

      // Находим индексы колонок
      const brandCol = Object.keys(mapping).find(k => mapping[k] === "brand");
      const articleCol = Object.keys(mapping).find(k => mapping[k] === "article");
      const replacementCol = Object.keys(mapping).find(k => mapping[k] === "replacement");
      const nameCol = Object.keys(mapping).find(k => mapping[k] === "name");
      const moqCol = Object.keys(mapping).find(k => mapping[k] === "moq");
      const priceCol = Object.keys(mapping).find(k => mapping[k] === "price");

      if (!articleCol || !priceCol) {
        return res.status(400).json({ error: "Колонки Артикул и Цена обязательны" });
      }

      // Подготавливаем SQL запросы
      const insertPart = db.prepare(`
        INSERT INTO parts (brand, article_norm, name) 
        VALUES (?, ?, ?) 
        ON CONFLICT(brand, article_norm) DO UPDATE SET name = excluded.name
        RETURNING id
      `);
      const getPart = db.prepare(`SELECT id FROM parts WHERE brand = ? AND article_norm = ?`);
      
      const insertOffer = db.prepare(`
        INSERT INTO offers (task_id, supplier_id, part_id, original_article, replacement_article, replacement_norm, price, moq)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let processedCount = 0;
      let errorCount = 0;

      // Транзакция для быстрой вставки
      const processTransaction = db.transaction((rows: any[]) => {
        // Пропускаем первую строку (заголовки)
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;

          const rawArticle = row[Number(articleCol)]?.toString().trim();
          let rawPrice = row[Number(priceCol)]?.toString().trim();

          if (!rawArticle || !rawPrice) continue;

          // Нормализация артикула (только буквы и цифры, верхний регистр)
          const articleNorm = rawArticle.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          if (!articleNorm) continue;

          const brand = brandCol ? (row[Number(brandCol)]?.toString().trim() || defaultBrand || "UNKNOWN") : (defaultBrand || "UNKNOWN");
          const name = nameCol ? row[Number(nameCol)]?.toString().trim() : null;
          const replacement = replacementCol ? row[Number(replacementCol)]?.toString().trim() : null;
          const replacementNorm = replacement ? replacement.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() : null;
          const moq = moqCol ? parseInt(row[Number(moqCol)], 10) || 1 : 1;

          // Очистка цены
          rawPrice = rawPrice.replace(/[^\d.,]/g, '').replace(',', '.');
          let price = parseFloat(rawPrice);
          
          if (isNaN(price) || price <= 0) {
            errorCount++;
            continue;
          }

          // Вычет НДС если нужно
          if (hasVat) {
            price = price / 1.07;
          }

          // Вставка или обновление детали
          let partId;
          try {
            const result = insertPart.get(brand, articleNorm, name) as { id: number } | undefined;
            if (result) {
              partId = result.id;
            } else {
               const existing = getPart.get(brand, articleNorm) as { id: number };
               partId = existing.id;
            }
          } catch (e) {
             const existing = getPart.get(brand, articleNorm) as { id: number };
             partId = existing.id;
          }

          // Вставка предложения
          insertOffer.run(taskId, supplierId, partId, rawArticle, replacement, replacementNorm, price, moq);
          processedCount++;
        }
      });

      processTransaction(data);

      res.json({ success: true, processedCount, errorCount });

    } catch (err) {
      console.error("Process file error:", err);
      res.status(500).json({ error: "Failed to process file" });
    }
  });

  // Обработка эталонного файла (заказа)
  app.post("/api/tasks/:id/process-reference", async (req, res) => {
    try {
      const taskId = req.params.id;
      const { fileId, mapping, sheetName, defaultBrand } = req.body;

      if (!fileId || !mapping) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const filePath = path.join(uploadsDir, fileId);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }

      const workbook = xlsx.readFile(filePath);
      const targetSheet = sheetName && workbook.SheetNames.includes(sheetName) ? sheetName : workbook.SheetNames[0];
      const sheet = workbook.Sheets[targetSheet];
      const data = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });

      const brandCol = Object.keys(mapping).find(k => mapping[k] === "brand");
      const articleCol = Object.keys(mapping).find(k => mapping[k] === "article");
      const nameCol = Object.keys(mapping).find(k => mapping[k] === "name");
      const qtyCol = Object.keys(mapping).find(k => mapping[k] === "quantity");

      if (!articleCol) {
        return res.status(400).json({ error: "Колонка Артикул обязательна" });
      }

      const insertRef = db.prepare(`
        INSERT INTO reference_items (task_id, brand, article_norm, original_article, name, quantity)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id, brand, article_norm) DO UPDATE SET 
          quantity = reference_items.quantity + excluded.quantity,
          name = excluded.name
      `);

      let processedCount = 0;

      const processTransaction = db.transaction((rows: any[]) => {
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;

          const rawArticle = row[Number(articleCol)]?.toString().trim();
          if (!rawArticle) continue;

          const articleNorm = rawArticle.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          if (!articleNorm) continue;

          const brand = brandCol ? (row[Number(brandCol)]?.toString().trim() || defaultBrand || "UNKNOWN") : (defaultBrand || "UNKNOWN");
          const name = nameCol ? row[Number(nameCol)]?.toString().trim() : null;
          const qty = qtyCol ? parseInt(row[Number(qtyCol)], 10) || 1 : 1;

          insertRef.run(taskId, brand, articleNorm, rawArticle, name, qty);
          processedCount++;
        }
      });

      processTransaction(data);

      res.json({ success: true, processedCount });
    } catch (err) {
      console.error("Process reference error:", err);
      res.status(500).json({ error: "Failed to process reference file" });
    }
  });

  // Получение результатов задачи
  app.get("/api/tasks/:id/results", async (req, res) => {
    try {
      const taskId = req.params.id;
      
      const query = `
        WITH CurrentOffers AS (
          SELECT 
            p.id as part_id,
            p.brand,
            p.article_norm,
            p.name,
            o.id as offer_id,
            o.price,
            s.name as supplier_name,
            o.original_article,
            o.replacement_article,
            o.replacement_norm,
            o.replacement_status
          FROM offers o
          JOIN parts p ON o.part_id = p.id
          JOIN suppliers s ON o.supplier_id = s.id
          WHERE o.task_id = ? AND o.price > 0
        ),
        OffersAgg AS (
          SELECT 
            part_id,
            brand,
            article_norm as offered_article_norm,
            name,
            MIN(price) as min_price,
            json_group_array(json_object(
              'offer_id', offer_id,
              'supplier_name', supplier_name,
              'price', price,
              'original_article', original_article,
              'offered_article_norm', article_norm,
              'replacement_article', replacement_article,
              'replacement_norm', replacement_norm,
              'replacement_status', replacement_status
            )) as offers_json
          FROM CurrentOffers
          GROUP BY part_id, brand, article_norm, name
        ),
        OfferMatchKeys AS (
          SELECT part_id, brand, article_norm as match_norm FROM CurrentOffers
          UNION
          SELECT part_id, brand, replacement_norm as match_norm FROM CurrentOffers WHERE replacement_norm IS NOT NULL
        ),
        PreviousOffers AS (
          SELECT 
            o.part_id,
            MIN(o.price) as prev_min_price
          FROM offers o
          JOIN tasks t ON o.task_id = t.id
          WHERE o.task_id != ? AND t.date < (SELECT date FROM tasks WHERE id = ?) AND o.price > 0
          GROUP BY o.part_id
        ),
        RefItems AS (
          SELECT 
            brand,
            article_norm as ref_article_norm,
            original_article as ref_article,
            name as ref_name,
            quantity as ref_quantity
          FROM reference_items
          WHERE task_id = ?
        ),
        MatchedPairs AS (
          SELECT r.ref_article_norm, r.brand, c.part_id
          FROM RefItems r
          JOIN OfferMatchKeys mk ON r.brand = mk.brand AND r.ref_article_norm = mk.match_norm
          JOIN OffersAgg c ON mk.part_id = c.part_id
          GROUP BY r.ref_article_norm, r.brand, c.part_id
        ),
        Combined AS (
          -- 1. Matched items
          SELECT 
            c.part_id,
            r.brand,
            r.ref_article_norm,
            c.offered_article_norm,
            r.ref_article,
            r.ref_name,
            r.ref_quantity,
            COALESCE(r.ref_name, c.name) as name,
            c.min_price,
            c.offers_json
          FROM MatchedPairs mp
          JOIN RefItems r ON mp.ref_article_norm = r.ref_article_norm AND mp.brand = r.brand
          JOIN OffersAgg c ON mp.part_id = c.part_id

          UNION ALL

          -- 2. RefItems with no matches
          SELECT 
            0 as part_id,
            r.brand,
            r.ref_article_norm,
            NULL as offered_article_norm,
            r.ref_article,
            r.ref_name,
            r.ref_quantity,
            r.ref_name as name,
            NULL as min_price,
            NULL as offers_json
          FROM RefItems r
          WHERE NOT EXISTS (
            SELECT 1 FROM OfferMatchKeys mk WHERE mk.brand = r.brand AND mk.match_norm = r.ref_article_norm
          )

          UNION ALL

          -- 3. OffersAgg with no matches
          SELECT 
            c.part_id,
            c.brand,
            NULL as ref_article_norm,
            c.offered_article_norm,
            NULL as ref_article,
            NULL as ref_name,
            NULL as ref_quantity,
            c.name,
            c.min_price,
            c.offers_json
          FROM OffersAgg c
          WHERE NOT EXISTS (
            SELECT 1 FROM OfferMatchKeys mk 
            JOIN RefItems r ON r.brand = mk.brand AND r.ref_article_norm = mk.match_norm
            WHERE mk.part_id = c.part_id
          )
        )
        SELECT 
          cb.part_id,
          cb.brand,
          cb.ref_article_norm,
          cb.offered_article_norm,
          cb.ref_article,
          cb.ref_name,
          cb.ref_quantity,
          cb.name,
          cb.min_price,
          cb.offers_json,
          p.prev_min_price,
          CASE 
            WHEN p.prev_min_price IS NOT NULL AND p.prev_min_price > 0 
            THEN ((cb.min_price - p.prev_min_price) / p.prev_min_price) * 100 
            ELSE NULL 
          END as diff_percent
        FROM Combined cb
        LEFT JOIN PreviousOffers p ON cb.part_id = p.part_id
        ORDER BY cb.brand, COALESCE(cb.ref_article_norm, cb.offered_article_norm)
      `;

      const rawResults = db.prepare(query).all(taskId, taskId, taskId, taskId);
      const results = rawResults.map((row: any) => ({
        ...row,
        offers: row.offers_json ? JSON.parse(row.offers_json) : []
      }));
      res.json(results);
    } catch (err) {
      console.error("Failed to fetch results", err);
      res.status(500).json({ error: "Failed to fetch results" });
    }
  });

  // Обновление статуса замены
  app.post("/api/offers/:id/status", async (req, res) => {
    try {
      const offerId = req.params.id;
      const { status } = req.body;
      
      if (!['pending', 'approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const stmt = db.prepare('UPDATE offers SET replacement_status = ? WHERE id = ?');
      const result = stmt.run(status, offerId);
      
      if (result.changes === 0) {
        return res.status(404).json({ error: "Offer not found" });
      }
      
      res.json({ success: true, status });
    } catch (err) {
      console.error("Failed to update offer status:", err);
      res.status(500).json({ error: "Failed to update offer status" });
    }
  });

  // Vite integration for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Global error handler to ensure JSON responses for API errors
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global error:", err);
    if (req.path.startsWith("/api/")) {
      res.status(500).json({ error: err.message || "Internal Server Error" });
    } else {
      next(err);
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] Running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("[SERVER_ERROR]", err);
  process.exit(1);
});
