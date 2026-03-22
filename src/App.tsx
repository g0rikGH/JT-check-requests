import { motion } from "motion/react";
import { Terminal, Plus, FileSpreadsheet, Calendar, ArrowRight, Activity, Settings, ArrowLeft, Upload, CheckCircle2, Database, Trash2, Filter, Pencil, Check, X, Download } from "lucide-react";
import React, { useState, useEffect, useRef } from "react";
import { utils, writeFile } from "xlsx";

interface Task {
  id: number;
  name: string;
  date: string;
}

interface Supplier {
  id: number;
  name: string;
}

interface PreviewData {
  fileId: string;
  sheets: string[];
  currentSheet: string;
  headers: string[];
  rows: any[][];
}

interface Offer {
  offer_id: number;
  supplier_name: string;
  price: number;
  original_article: string;
  offered_article_norm: string;
  replacement_article: string | null;
  replacement_norm: string | null;
  replacement_status: 'pending' | 'approved' | 'rejected';
}

interface TaskResult {
  part_id: number;
  brand: string;
  ref_article_norm: string | null;
  offered_article_norm: string | null;
  ref_article: string | null;
  ref_quantity: number | null;
  name: string | null;
  min_price: number | null;
  offers: Offer[];
  prev_min_price: number | null;
  diff_percent: number | null;
}

const MAPPING_OPTIONS = [
  { value: "ignore", label: "— Игнорировать —" },
  { value: "brand", label: "Бренд" },
  { value: "article", label: "Артикул" },
  { value: "replacement", label: "Артикул замены" },
  { value: "name", label: "Название" },
  { value: "moq", label: "MOQ" },
  { value: "price", label: "Цена" },
];

const MAPPING_OPTIONS_REF = [
  { value: "ignore", label: "— Игнорировать —" },
  { value: "brand", label: "Бренд" },
  { value: "article", label: "Артикул" },
  { value: "name", label: "Название" },
  { value: "quantity", label: "Количество" },
];

export default function App() {
  const [health, setHealth] = useState<{ status: string; version: string } | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Routing state
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [currentTab, setCurrentTab] = useState<"tasks" | "settings">("tasks");

  // Dashboard state
  const [newTaskName, setNewTaskName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Settings state
  const [newSupplierName, setNewSupplierName] = useState("");
  const [isAddingSupplier, setIsAddingSupplier] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<number | null>(null);
  const [editingSupplierName, setEditingSupplierName] = useState("");

  // Task Details state
  const [selectedSupplier, setSelectedSupplier] = useState<string>("");
  const [hasVat, setHasVat] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<number, string>>({});
  const [defaultBrand, setDefaultBrand] = useState<string>("");
  const [referenceBrands, setReferenceBrands] = useState<string[]>([]);
  const [isReferenceMode, setIsReferenceMode] = useState(false);
  const [results, setResults] = useState<TaskResult[]>([]);
  const [isResultsLoading, setIsResultsLoading] = useState(false);
  const [resultFilter, setResultFilter] = useState<"all" | "no_response" | "with_response" | "extra_items">("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [replacementFilter, setReplacementFilter] = useState<string>("all");
  const [hideRejected, setHideRejected] = useState<boolean>(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refFileInputRef = useRef<HTMLInputElement>(null);

  const uniqueBrands = Array.from(new Set(results.map(r => r.brand).filter(Boolean))).sort();
  const uniqueSuppliers = Array.from(new Set(results.flatMap(r => r.offers?.map(o => o.supplier_name) || []).filter(Boolean))).sort();

  const getActiveOffer = (row: TaskResult, supplier: string) => {
    if (!row.offers || row.offers.length === 0) return null;
    
    const validOffers = hideRejected 
      ? row.offers.filter(o => o.replacement_status !== 'rejected')
      : row.offers;
      
    if (validOffers.length === 0) return null;

    if (supplier === "all") {
      return validOffers.reduce((min, curr) => curr.price < min.price ? curr : min, validOffers[0]);
    }
    return validOffers.find(o => o.supplier_name === supplier) || null;
  };

  const getReplacementType = (reqNorm: string | null, activeOffer: Offer | null) => {
    if (!reqNorm || !activeOffer) return "none";
    
    let actualOffered = activeOffer.offered_article_norm;
    
    // Если поставщик указал эталон в артикуле, а замену в колонке замен
    if (activeOffer.offered_article_norm === reqNorm && activeOffer.replacement_norm && activeOffer.replacement_norm !== reqNorm) {
      actualOffered = activeOffer.replacement_norm;
    }
    // Если поставщик указал замену в артикуле, а эталон в колонке замен
    else if (activeOffer.replacement_norm === reqNorm && activeOffer.offered_article_norm !== reqNorm) {
      actualOffered = activeOffer.offered_article_norm;
    }

    if (reqNorm === actualOffered) return "none";
    
    if (actualOffered.startsWith(reqNorm) && actualOffered.length - reqNorm.length <= 2) {
      return "good";
    }
    return "bad";
  };

  const handleStatusChange = async (offerId: number, status: 'approved' | 'rejected' | 'pending') => {
    try {
      const res = await fetch(`/api/offers/${offerId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error("Failed to update status");
      
      setResults(prev => prev.map(row => ({
        ...row,
        offers: row.offers?.map(o => o.offer_id === offerId ? { ...o, replacement_status: status } : o)
      })));
    } catch (err) {
      console.error(err);
      alert("Ошибка при обновлении статуса");
    }
  };

  const filteredResults = results.filter(row => {
    const activeOffer = getActiveOffer(row, supplierFilter);
    
    if (brandFilter !== "all" && row.brand !== brandFilter) return false;
    
    if (resultFilter === "no_response" && activeOffer) return false;
    if (resultFilter === "with_response" && !activeOffer) return false;
    if (resultFilter === "extra_items" && row.ref_article) return false;

    if (replacementFilter !== "all") {
      if (!activeOffer) return false;
      const repType = getReplacementType(row.ref_article_norm, activeOffer);
      if (replacementFilter === "good" && repType !== "good") return false;
      if (replacementFilter === "bad" && repType !== "bad") return false;
      if (replacementFilter === "none" && repType !== "none") return false;
      if (replacementFilter === "any_replacement" && repType === "none") return false;
    }

    return true;
  });

  useEffect(() => {
    const init = async () => {
      try {
        const [healthRes, tasksRes, suppliersRes] = await Promise.all([
          fetch("/api/health"),
          fetch("/api/tasks"),
          fetch("/api/suppliers")
        ]);
        setHealth(await healthRes.json());
        setTasks(await tasksRes.json());
        setSuppliers(await suppliersRes.json());
      } catch (err) {
        console.error("Failed to initialize", err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const fetchResults = async (taskId: number) => {
    setIsResultsLoading(true);
    try {
      const [res, brandsRes] = await Promise.all([
        fetch(`/api/tasks/${taskId}/results`),
        fetch(`/api/tasks/${taskId}/brands`)
      ]);
      const data = await res.json();
      const brandsData = await brandsRes.json();
      setResults(data);
      setReferenceBrands(brandsData);
    } catch (err) {
      console.error("Failed to fetch results", err);
    } finally {
      setIsResultsLoading(false);
    }
  };

  const handleExportExcel = () => {
    if (filteredResults.length === 0) return;

    const data = filteredResults.map(row => {
      const activeOffer = getActiveOffer(row, supplierFilter);
      return {
        "Бренд": row.brand || "",
        "Артикул (Эталон)": row.ref_article || "",
        "Артикул (Прайс)": activeOffer ? activeOffer.offered_article_norm : "",
        "Замена": activeOffer?.replacement_norm || "",
        "Название": row.name || "",
        "Кол-во (Эталон)": row.ref_quantity || 0,
        "Лучшая цена": activeOffer ? activeOffer.price : "",
        "Поставщик": activeOffer ? activeOffer.supplier_name : "",
        "Прошлая цена": row.prev_min_price || "",
        "Разница %": row.diff_percent !== null ? (row.diff_percent > 0 ? "+" : "") + row.diff_percent.toFixed(1) + "%" : ""
      };
    });

    const ws = utils.json_to_sheet(data);
    
    // Auto-size columns
    const colWidths = Object.keys(data[0] || {}).map(key => ({
      wch: Math.max(key.length, ...data.map(row => String((row as any)[key]).length)) + 2
    }));
    ws['!cols'] = colWidths;

    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Сводная таблица");
    
    const fileName = `Сводная_${selectedTask?.name || 'результаты'}_${new Date().toISOString().split('T')[0]}.xlsx`;
    writeFile(wb, fileName);
  };

  useEffect(() => {
    if (selectedTaskId) {
      fetchResults(selectedTaskId);
    } else {
      setResults([]);
      setReferenceBrands([]);
    }
  }, [selectedTaskId]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskName.trim()) return;
    
    setIsCreating(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTaskName })
      });
      const newTask = await res.json();
      setTasks([newTask, ...tasks]);
      setNewTaskName("");
    } catch (err) {
      console.error("Failed to create task", err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplierName.trim()) return;
    
    setIsAddingSupplier(true);
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSupplierName })
      });
      const newSupplier = await res.json();
      setSuppliers([...suppliers, newSupplier].sort((a, b) => a.name.localeCompare(b.name)));
      setNewSupplierName("");
    } catch (err) {
      console.error("Failed to add supplier", err);
    } finally {
      setIsAddingSupplier(false);
    }
  };

  const handleDeleteSupplier = async (id: number) => {
    if (!confirm("Вы уверены, что хотите удалить этого поставщика?")) return;
    
    try {
      await fetch(`/api/suppliers/${id}`, { method: "DELETE" });
      setSuppliers(suppliers.filter(s => s.id !== id));
    } catch (err) {
      console.error("Failed to delete supplier", err);
    }
  };

  const handleUpdateSupplier = async (id: number) => {
    if (!editingSupplierName.trim()) return;
    
    try {
      const res = await fetch(`/api/suppliers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingSupplierName })
      });
      const updatedSupplier = await res.json();
      setSuppliers(suppliers.map(s => s.id === id ? updatedSupplier : s).sort((a, b) => a.name.localeCompare(b.name)));
      setEditingSupplierId(null);
      setEditingSupplierName("");
    } catch (err) {
      console.error("Failed to update supplier", err);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, isRef: boolean = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setIsReferenceMode(isRef);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload-preview", {
        method: "POST",
        body: formData
      });
      
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await res.text();
        console.error("Non-JSON response:", text);
        throw new Error(`Сервер вернул ошибку: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      if (res.ok) {
        setPreviewData(data);
        // Pre-fill mapping with "ignore"
        const initialMapping: Record<number, string> = {};
        data.headers.forEach((_: any, idx: number) => {
          initialMapping[idx] = "ignore";
        });
        setColumnMapping(initialMapping);
        setDefaultBrand("");
      } else {
        alert(data.error || "Ошибка загрузки файла");
      }
    } catch (err: any) {
      console.error("Upload failed", err);
      alert(err.message || "Ошибка при загрузке файла");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (refFileInputRef.current) refFileInputRef.current.value = "";
    }
  };

  const handleSheetChange = async (sheetName: string) => {
    if (!previewData) return;
    setIsUploading(true);
    try {
      const res = await fetch(`/api/preview/${previewData.fileId}?sheetName=${encodeURIComponent(sheetName)}`);
      const data = await res.json();
      if (res.ok) {
        setPreviewData(data);
        const initialMapping: Record<number, string> = {};
        data.headers.forEach((_: any, idx: number) => {
          initialMapping[idx] = "ignore";
        });
        setColumnMapping(initialMapping);
      } else {
        alert(data.error || "Ошибка загрузки листа");
      }
    } catch (err) {
      console.error("Sheet change failed", err);
      alert("Ошибка при смене листа");
    } finally {
      setIsUploading(false);
    }
  };

  const handleMappingChange = (colIndex: number, value: string) => {
    setColumnMapping(prev => ({ ...prev, [colIndex]: value }));
  };

  const handleProcessFile = async () => {
    if (!previewData || !selectedTaskId) return;
    
    if (!isReferenceMode && !selectedSupplier) {
      alert("Выберите поставщика");
      return;
    }

    const hasArticle = Object.values(columnMapping).includes("article");
    if (!hasArticle) {
      alert("Необходимо указать колонку 'Артикул'");
      return;
    }

    if (!isReferenceMode) {
      const hasPrice = Object.values(columnMapping).includes("price");
      if (!hasPrice) {
        alert("Необходимо указать колонку 'Цена'");
        return;
      }
    }

    setIsProcessing(true);
    try {
      const endpoint = isReferenceMode 
        ? `/api/tasks/${selectedTaskId}/process-reference`
        : `/api/tasks/${selectedTaskId}/process-file`;

      const bodyData = isReferenceMode 
        ? {
            fileId: previewData.fileId,
            mapping: columnMapping,
            sheetName: previewData.currentSheet,
            defaultBrand
          }
        : {
            fileId: previewData.fileId,
            supplierId: selectedSupplier,
            hasVat,
            mapping: columnMapping,
            sheetName: previewData.currentSheet,
            defaultBrand
          };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyData)
      });
      
      const data = await res.json();
      if (res.ok) {
        alert(`Файл успешно обработан!\nДобавлено строк: ${data.processedCount}${data.errorCount !== undefined ? `\nОшибок: ${data.errorCount}` : ''}`);
        setPreviewData(null);
        setSelectedSupplier("");
        setHasVat(false);
        setDefaultBrand("");
        setIsReferenceMode(false);
        fetchResults(selectedTaskId);
      } else {
        alert(data.error || "Ошибка при обработке файла");
      }
    } catch (err) {
      console.error("Process failed", err);
      alert("Ошибка при обработке файла");
    } finally {
      setIsProcessing(false);
    }
  };

  const selectedTask = tasks.find(t => t.id === selectedTaskId);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-emerald-500/30">
      {/* Navigation */}
      <nav className="border-b border-white/5 bg-black/20 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div 
              className="flex items-center gap-2 font-mono font-bold text-xl tracking-tighter cursor-pointer"
              onClick={() => {
                setSelectedTaskId(null);
                setCurrentTab("tasks");
              }}
            >
              <Terminal className="w-6 h-6 text-emerald-500" />
              <span>AUTO<span className="text-emerald-500">_</span>PARTS_ETL</span>
            </div>
            
            <div className="hidden md:flex items-center gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
              <button
                onClick={() => {
                  setSelectedTaskId(null);
                  setCurrentTab("tasks");
                }}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                  currentTab === "tasks" && !selectedTaskId
                    ? "bg-white/10 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                }`}
              >
                Задачи
              </button>
              <button
                onClick={() => {
                  setSelectedTaskId(null);
                  setCurrentTab("settings");
                }}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                  currentTab === "settings"
                    ? "bg-white/10 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                }`}
              >
                Настройки
              </button>
            </div>
          </div>
          <div className="flex items-center gap-6 text-sm font-medium text-zinc-400">
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10">
              <Activity className={`w-3 h-3 ${health?.status === "online" ? "text-emerald-500" : "text-zinc-500"}`} />
              <span className="text-[10px] uppercase tracking-widest font-bold">
                {loading ? "Checking..." : (health?.status || "Offline")}
              </span>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-12">
        {currentTab === "settings" ? (
          /* SETTINGS VIEW */
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="mb-12">
              <h1 className="text-4xl font-bold tracking-tight mb-4">Настройки</h1>
              <p className="text-zinc-400 text-lg">Управление справочниками и параметрами системы.</p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-500" />
                Справочник поставщиков
              </h2>
              
              <form onSubmit={handleAddSupplier} className="flex gap-4 mb-8">
                <input
                  type="text"
                  placeholder="Название нового поставщика..."
                  className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  disabled={isAddingSupplier}
                />
                <button
                  type="submit"
                  disabled={isAddingSupplier || !newSupplierName.trim()}
                  className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-6 py-3 rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Добавить
                </button>
              </form>

              <div className="space-y-2">
                {suppliers.map(supplier => (
                  <div key={supplier.id} className="flex items-center justify-between bg-black/20 border border-white/5 rounded-xl p-4 hover:bg-white/5 transition-colors">
                    {editingSupplierId === supplier.id ? (
                      <div className="flex-1 flex items-center gap-3 mr-4">
                        <input
                          type="text"
                          value={editingSupplierName}
                          onChange={(e) => setEditingSupplierName(e.target.value)}
                          className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleUpdateSupplier(supplier.id);
                            if (e.key === 'Escape') setEditingSupplierId(null);
                          }}
                        />
                        <button
                          onClick={() => handleUpdateSupplier(supplier.id)}
                          className="text-emerald-500 hover:text-emerald-400 p-2 rounded-lg hover:bg-emerald-400/10 transition-colors"
                          title="Сохранить"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditingSupplierId(null)}
                          className="text-zinc-500 hover:text-zinc-300 p-2 rounded-lg hover:bg-white/5 transition-colors"
                          title="Отмена"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="font-medium">{supplier.name}</span>
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => {
                              setEditingSupplierId(supplier.id);
                              setEditingSupplierName(supplier.name);
                            }}
                            className="text-zinc-500 hover:text-blue-400 p-2 rounded-lg hover:bg-blue-400/10 transition-colors"
                            title="Редактировать поставщика"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteSupplier(supplier.id)}
                            className="text-zinc-500 hover:text-red-400 p-2 rounded-lg hover:bg-red-400/10 transition-colors"
                            title="Удалить поставщика"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {suppliers.length === 0 && (
                  <div className="text-center py-8 text-zinc-500">
                    Нет добавленных поставщиков
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ) : !selectedTaskId ? (
          /* DASHBOARD VIEW */
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="flex items-center justify-between mb-12">
              <div>
                <h1 className="text-4xl font-bold tracking-tight mb-2">Задачи проценки</h1>
                <p className="text-zinc-400">Управление сравнениями цен от поставщиков</p>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {/* Создание новой задачи */}
              <div className="md:col-span-1">
                <div className="p-6 rounded-2xl bg-zinc-900/50 border border-white/5 sticky top-24">
                  <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <Plus className="w-5 h-5 text-emerald-500" />
                    Новая задача
                  </h2>
                  <form onSubmit={handleCreateTask} className="flex flex-col gap-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">
                        Название (например, "Заказ 21.03")
                      </label>
                      <input
                        type="text"
                        value={newTaskName}
                        onChange={(e) => setNewTaskName(e.target.value)}
                        placeholder="Введите название..."
                        className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
                      />
                    </div>
                    <button 
                      type="submit"
                      disabled={!newTaskName.trim() || isCreating}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 text-white font-medium px-4 py-2.5 rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                      {isCreating ? "Создание..." : "Создать задачу"}
                    </button>
                  </form>
                </div>
              </div>

              {/* Список задач */}
              <div className="md:col-span-2 flex flex-col gap-4">
                {loading ? (
                  <div className="p-8 text-center text-zinc-500 animate-pulse">Загрузка задач...</div>
                ) : tasks.length === 0 ? (
                  <div className="p-12 text-center border border-dashed border-white/10 rounded-2xl text-zinc-500">
                    <FileSpreadsheet className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>Нет активных задач.</p>
                    <p className="text-sm">Создайте первую задачу слева, чтобы начать загрузку прайсов.</p>
                  </div>
                ) : (
                  tasks.map((task, idx) => (
                    <motion.div
                      key={task.id}
                      onClick={() => {
                        setSelectedTaskId(task.id);
                        setPreviewData(null);
                        setSelectedSupplier("");
                      }}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: idx * 0.05 }}
                      className="p-6 rounded-2xl bg-zinc-900/30 border border-white/5 hover:border-white/10 transition-all group cursor-pointer flex items-center justify-between"
                    >
                      <div>
                        <h3 className="text-xl font-bold mb-1 group-hover:text-emerald-400 transition-colors">
                          {task.name}
                        </h3>
                        <div className="flex items-center gap-4 text-xs text-zinc-500 font-mono">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(task.date).toLocaleDateString("ru-RU", { 
                              day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' 
                            })}
                          </span>
                          <span>ID: {task.id}</span>
                        </div>
                      </div>
                      <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-emerald-500/10 group-hover:text-emerald-500 transition-all">
                        <ArrowRight className="w-5 h-5" />
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        ) : (
          /* TASK DETAILS VIEW */
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
            <button 
              onClick={() => setSelectedTaskId(null)}
              className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-8 text-sm font-medium"
            >
              <ArrowLeft className="w-4 h-4" /> Назад к списку
            </button>

            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold tracking-tight mb-2">{selectedTask?.name}</h1>
                <p className="text-zinc-400 font-mono text-sm">
                  Создана: {selectedTask ? new Date(selectedTask.date).toLocaleString("ru-RU") : ""}
                </p>
              </div>
            </div>

            <div className="grid md:grid-cols-4 gap-8">
              {/* Левая колонка: Загрузка */}
              <div className="md:col-span-1 flex flex-col gap-6">
                <div className="p-6 rounded-2xl bg-zinc-900/50 border border-white/5">
                  <h3 className="font-bold mb-4">1. Загрузка эталона</h3>
                  <input 
                    type="file" 
                    accept=".xlsx, .xls, .csv" 
                    className="hidden" 
                    ref={refFileInputRef}
                    onChange={(e) => handleFileUpload(e, true)}
                  />
                  <button 
                    onClick={() => {
                      setIsReferenceMode(true);
                      refFileInputRef.current?.click();
                    }}
                    disabled={isUploading}
                    className="w-full border-2 border-dashed border-white/10 hover:border-emerald-500/50 disabled:opacity-50 disabled:hover:border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center gap-3 transition-all group mb-6"
                  >
                    <div className="w-10 h-10 rounded-full bg-white/5 group-hover:bg-emerald-500/10 flex items-center justify-center text-zinc-400 group-hover:text-emerald-500 transition-all">
                      <FileSpreadsheet className="w-5 h-5" />
                    </div>
                    <div className="text-center">
                      <span className="block text-sm font-medium text-zinc-300 group-hover:text-white mb-1">
                        {isUploading && isReferenceMode ? "Загрузка..." : "Загрузить эталон"}
                      </span>
                    </div>
                  </button>

                  <h3 className="font-bold mb-4">2. Параметры прайса</h3>
                  
                  <div className="mb-4">
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">
                      Поставщик
                    </label>
                    <select 
                      value={selectedSupplier}
                      onChange={(e) => setSelectedSupplier(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500/50 transition-all text-white"
                    >
                      <option value="" disabled>Выберите поставщика...</option>
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="mb-6">
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div className="relative flex items-center justify-center w-5 h-5 border border-white/20 rounded bg-black/50 group-hover:border-emerald-500/50 transition-colors">
                        <input 
                          type="checkbox" 
                          className="peer sr-only"
                          checked={hasVat}
                          onChange={(e) => setHasVat(e.target.checked)}
                        />
                        <CheckCircle2 className={`w-3.5 h-3.5 text-emerald-500 absolute opacity-0 peer-checked:opacity-100 transition-opacity`} />
                      </div>
                      <span className="text-sm text-zinc-300 group-hover:text-white transition-colors">
                        Цена включает НДС 7%
                      </span>
                    </label>
                  </div>

                  <h3 className="font-bold mb-4">3. Загрузка файла</h3>
                  <input 
                    type="file" 
                    accept=".xlsx, .xls, .csv" 
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={(e) => handleFileUpload(e, false)}
                  />
                  <button 
                    onClick={() => {
                      setIsReferenceMode(false);
                      fileInputRef.current?.click();
                    }}
                    disabled={isUploading || (!isReferenceMode && !selectedSupplier)}
                    className="w-full border-2 border-dashed border-white/10 hover:border-emerald-500/50 disabled:opacity-50 disabled:hover:border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center gap-3 transition-all group"
                  >
                    <div className="w-10 h-10 rounded-full bg-white/5 group-hover:bg-emerald-500/10 flex items-center justify-center text-zinc-400 group-hover:text-emerald-500 transition-all">
                      <Upload className="w-5 h-5" />
                    </div>
                    <div className="text-center">
                      <span className="block text-sm font-medium text-zinc-300 group-hover:text-white mb-1">
                        {isUploading && !isReferenceMode ? "Загрузка..." : "Загрузить прайс"}
                      </span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Правая колонка: Превью и Маппинг */}
              <div className="md:col-span-3">
                {previewData ? (
                  <div className="p-6 rounded-2xl bg-zinc-900/50 border border-white/5 overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h3 className="font-bold text-lg mb-2">Настройка колонок {isReferenceMode ? "(Эталон)" : "(Прайс)"}</h3>
                        {previewData.sheets && previewData.sheets.length > 1 && (
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-zinc-400">Лист:</span>
                            <select 
                              value={previewData.currentSheet}
                              onChange={(e) => handleSheetChange(e.target.value)}
                              className="bg-black/50 border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500/50 transition-all text-white"
                            >
                              {previewData.sheets.map(s => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        {!Object.values(columnMapping).includes("brand") && (
                          <div className="relative">
                            <input
                              type="text"
                              list="brand-options"
                              placeholder="Бренд по умолчанию"
                              value={defaultBrand}
                              onChange={(e) => setDefaultBrand(e.target.value)}
                              className="bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50 transition-all w-48 text-white"
                            />
                            {referenceBrands.length > 0 && (
                              <datalist id="brand-options">
                                {referenceBrands.map(b => (
                                  <option key={b} value={b} />
                                ))}
                              </datalist>
                            )}
                          </div>
                        )}
                        <button 
                          onClick={handleProcessFile}
                          disabled={isProcessing}
                          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 text-white px-6 py-2 rounded-xl text-sm font-medium transition-all"
                        >
                          {isProcessing ? "Обработка..." : "Начать обработку"}
                        </button>
                      </div>
                    </div>
                    
                    <div className="overflow-x-auto pb-4">
                      <table className="w-full text-sm text-left">
                        <thead>
                          <tr>
                            {previewData.headers.map((header, idx) => (
                              <th key={idx} className="px-4 py-3 bg-black/40 border-b border-white/5 min-w-[150px]">
                                <div className="mb-3 text-xs text-zinc-500 font-normal truncate" title={header}>
                                  Оригинал: {header}
                                </div>
                                <select 
                                  value={columnMapping[idx] || "ignore"}
                                  onChange={(e) => handleMappingChange(idx, e.target.value)}
                                  className={`w-full bg-zinc-800 border rounded-lg px-2 py-1.5 text-xs focus:outline-none transition-all ${
                                    columnMapping[idx] !== "ignore" 
                                      ? "border-emerald-500/50 text-emerald-400" 
                                      : "border-white/10 text-zinc-400"
                                  }`}
                                >
                                  {(isReferenceMode ? MAPPING_OPTIONS_REF : MAPPING_OPTIONS).map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                  ))}
                                </select>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.rows.map((row, rowIdx) => (
                            <tr key={rowIdx} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                              {row.map((cell, cellIdx) => (
                                <td key={cellIdx} className="px-4 py-3 text-zinc-300 truncate max-w-[200px]" title={String(cell)}>
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="h-full min-h-[400px] rounded-2xl border border-dashed border-white/10 flex flex-col items-center justify-center text-zinc-500 p-8 text-center">
                    <FileSpreadsheet className="w-16 h-16 mb-4 opacity-20" />
                    <h3 className="text-lg font-medium text-zinc-400 mb-2">Ожидание файла</h3>
                    <p className="max-w-md">
                      Выберите поставщика слева и загрузите файл с прайсом. 
                      Здесь появится превью первых строк для настройки колонок.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Таблица результатов */}
            {isResultsLoading ? (
              <div className="mt-12 flex flex-col items-center justify-center py-12 border border-white/5 rounded-2xl bg-black/20 backdrop-blur-xl">
                <div className="w-8 h-8 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mb-4"></div>
                <p className="text-zinc-400 font-medium">Загрузка данных, пожалуйста подождите...</p>
              </div>
            ) : results.length > 0 && (
              <div className="mt-12">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-6">
                    <h2 className="text-2xl font-bold tracking-tight">Сводная таблица</h2>
                    
                    <select
                      value={brandFilter}
                      onChange={(e) => setBrandFilter(e.target.value)}
                      className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs font-medium focus:outline-none focus:border-emerald-500/50 transition-all text-zinc-300"
                    >
                      <option value="all">Все бренды</option>
                      {uniqueBrands.map(brand => (
                        <option key={brand} value={brand}>{brand}</option>
                      ))}
                    </select>

                    <select
                      value={supplierFilter}
                      onChange={(e) => setSupplierFilter(e.target.value)}
                      className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs font-medium focus:outline-none focus:border-emerald-500/50 transition-all text-zinc-300"
                    >
                      <option value="all">Все поставщики</option>
                      {uniqueSuppliers.map(supplier => (
                        <option key={supplier} value={supplier}>{supplier}</option>
                      ))}
                    </select>

                    <select
                      value={replacementFilter}
                      onChange={(e) => setReplacementFilter(e.target.value)}
                      className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs font-medium focus:outline-none focus:border-emerald-500/50 transition-all text-zinc-300"
                    >
                      <option value="all">Все типы совпадений</option>
                      <option value="none">Точное совпадение</option>
                      <option value="any_replacement">Любая замена</option>
                      <option value="good">Хорошая замена</option>
                      <option value="bad">Плохая замена</option>
                    </select>

                    <label className="flex items-center gap-2 text-xs font-medium text-zinc-300 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={hideRejected} 
                        onChange={(e) => setHideRejected(e.target.checked)}
                        className="rounded border-white/10 bg-black/40 text-emerald-500 focus:ring-emerald-500/50"
                      />
                      Скрыть отклоненные замены
                    </label>

                    <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-lg p-1">
                      <button
                        onClick={() => setResultFilter("all")}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                          resultFilter === "all" ? "bg-white/10 text-white" : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        Все
                      </button>
                      <button
                        onClick={() => setResultFilter("with_response")}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 ${
                          resultFilter === "with_response" ? "bg-emerald-500/20 text-emerald-400" : "text-zinc-400 hover:text-emerald-400/70"
                        }`}
                      >
                        <div className="w-2 h-2 rounded-full bg-emerald-500/50"></div>
                        С ответом
                      </button>
                      <button
                        onClick={() => setResultFilter("no_response")}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 ${
                          resultFilter === "no_response" ? "bg-red-500/20 text-red-400" : "text-zinc-400 hover:text-red-400/70"
                        }`}
                      >
                        <div className="w-2 h-2 rounded-full bg-red-500/50"></div>
                        Без ответа
                      </button>
                      <button
                        onClick={() => setResultFilter("extra_items")}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 ${
                          resultFilter === "extra_items" ? "bg-blue-500/20 text-blue-400" : "text-zinc-400 hover:text-blue-400/70"
                        }`}
                      >
                        <div className="w-2 h-2 rounded-full bg-blue-500/50"></div>
                        Новые (нет в эталоне)
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-sm text-zinc-400">
                      Показано позиций: <span className="text-white font-medium">
                        {filteredResults.length}
                      </span> из {results.length}
                    </div>
                    <button
                      onClick={handleExportExcel}
                      className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded-lg text-xs font-bold transition-all shadow-lg shadow-emerald-500/20"
                    >
                      <Download className="w-4 h-4" />
                      Экспорт в Excel
                    </button>
                  </div>
                </div>
                
                <div className="rounded-2xl bg-zinc-900/50 border border-white/5 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead>
                        <tr className="bg-black/40 border-b border-white/5">
                          <th className="px-4 py-4 font-medium text-zinc-400">Бренд</th>
                          <th className="px-4 py-4 font-medium text-zinc-400">Артикул (Эталон)</th>
                          <th className="px-4 py-4 font-medium text-zinc-400">Артикул (Прайс)</th>
                          <th className="px-4 py-4 font-medium text-zinc-400">Замена</th>
                          <th className="px-4 py-4 font-medium text-zinc-400">Название</th>
                          <th className="px-4 py-4 font-medium text-zinc-400 text-right">Кол-во (Эталон)</th>
                          <th className="px-4 py-4 font-medium text-zinc-400 text-right">Лучшая цена</th>
                          <th className="px-4 py-4 font-medium text-zinc-400">Поставщик</th>
                          <th className="px-4 py-4 font-medium text-zinc-400 text-right">Прошлая цена</th>
                          <th className="px-4 py-4 font-medium text-zinc-400 text-right">Разница</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredResults.map((row, idx) => {
                          const activeOffer = getActiveOffer(row, supplierFilter);
                          const repType = getReplacementType(row.ref_article_norm, activeOffer);
                          
                          let rowBg = "hover:bg-white/[0.02]";
                          if (!activeOffer) rowBg = "bg-red-500/5 hover:bg-red-500/10";
                          else if (!row.ref_article) rowBg = "bg-blue-500/5 hover:bg-blue-500/10";
                          else if (repType === "bad") rowBg = "bg-orange-500/10 hover:bg-orange-500/20";
                          else if (repType === "good") rowBg = "bg-emerald-500/10 hover:bg-emerald-500/20";

                          return (
                            <tr key={idx} className={`border-b border-white/5 transition-colors ${rowBg}`}>
                              <td className="px-4 py-3 text-zinc-300">{row.brand}</td>
                              <td className="px-4 py-3 font-mono text-zinc-300">{row.ref_article || "—"}</td>
                              <td className="px-4 py-3 font-mono text-zinc-300">
                                <div className="flex items-center justify-between gap-2">
                                  <span>{activeOffer ? activeOffer.offered_article_norm : "—"}</span>
                                  {repType !== "none" && activeOffer?.offered_article_norm !== row.ref_article_norm && (
                                    <div className="flex items-center gap-0.5">
                                      <button 
                                        onClick={() => handleStatusChange(activeOffer.offer_id, activeOffer.replacement_status === 'approved' ? 'pending' : 'approved')}
                                        className={`p-1 rounded transition-colors ${activeOffer.replacement_status === 'approved' ? 'text-emerald-400 bg-emerald-500/20' : ((activeOffer.replacement_status === 'pending' || !activeOffer.replacement_status) && repType === 'good' ? 'text-emerald-400/50 hover:text-emerald-400 hover:bg-white/5' : 'text-zinc-500 hover:text-emerald-400 hover:bg-white/5')}`}
                                        title="Одобрить замену"
                                      >
                                        <Check className="w-4 h-4" />
                                      </button>
                                      <button 
                                        onClick={() => handleStatusChange(activeOffer.offer_id, activeOffer.replacement_status === 'rejected' ? 'pending' : 'rejected')}
                                        className={`p-1 rounded transition-colors ${activeOffer.replacement_status === 'rejected' ? 'text-orange-400 bg-orange-500/20' : ((activeOffer.replacement_status === 'pending' || !activeOffer.replacement_status) && repType === 'bad' ? 'text-orange-400/50 hover:text-orange-400 hover:bg-white/5' : 'text-zinc-500 hover:text-orange-400 hover:bg-white/5')}`}
                                        title="Отклонить замену"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 font-mono text-zinc-400">
                                <div className="flex items-center justify-between gap-2">
                                  <span>{activeOffer?.replacement_norm || "—"}</span>
                                  {repType !== "none" && activeOffer?.replacement_norm && activeOffer.replacement_norm !== row.ref_article_norm && (
                                    <div className="flex items-center gap-0.5">
                                      <button 
                                        onClick={() => handleStatusChange(activeOffer.offer_id, activeOffer.replacement_status === 'approved' ? 'pending' : 'approved')}
                                        className={`p-1 rounded transition-colors ${activeOffer.replacement_status === 'approved' ? 'text-emerald-400 bg-emerald-500/20' : ((activeOffer.replacement_status === 'pending' || !activeOffer.replacement_status) && repType === 'good' ? 'text-emerald-400/50 hover:text-emerald-400 hover:bg-white/5' : 'text-zinc-500 hover:text-emerald-400 hover:bg-white/5')}`}
                                        title="Одобрить замену"
                                      >
                                        <Check className="w-4 h-4" />
                                      </button>
                                      <button 
                                        onClick={() => handleStatusChange(activeOffer.offer_id, activeOffer.replacement_status === 'rejected' ? 'pending' : 'rejected')}
                                        className={`p-1 rounded transition-colors ${activeOffer.replacement_status === 'rejected' ? 'text-orange-400 bg-orange-500/20' : ((activeOffer.replacement_status === 'pending' || !activeOffer.replacement_status) && repType === 'bad' ? 'text-orange-400/50 hover:text-orange-400 hover:bg-white/5' : 'text-zinc-500 hover:text-orange-400 hover:bg-white/5')}`}
                                        title="Отклонить замену"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-zinc-400 max-w-[200px] truncate" title={row.name || ""}>
                                {row.name || "—"}
                              </td>
                              <td className="px-4 py-3 font-mono text-zinc-300 text-right">{row.ref_quantity || "—"}</td>
                              <td className="px-4 py-3 font-mono text-emerald-400 text-right font-medium">
                                {activeOffer ? activeOffer.price.toFixed(2) : <span className="text-red-400/70 text-xs">Нет ответа</span>}
                              </td>
                              <td className="px-4 py-3 text-zinc-300">
                                {activeOffer ? (
                                  <span className="px-2 py-1 rounded bg-white/5 text-xs">
                                    {activeOffer.supplier_name}
                                  </span>
                                ) : "—"}
                              </td>
                              <td className="px-4 py-3 font-mono text-zinc-500 text-right">
                                {row.prev_min_price != null ? row.prev_min_price.toFixed(2) : "—"}
                              </td>
                              <td className="px-4 py-3 font-mono text-right">
                                {row.diff_percent !== null ? (
                                  <span className={row.diff_percent > 0 ? "text-red-400" : row.diff_percent < 0 ? "text-emerald-400" : "text-zinc-500"}>
                                    {row.diff_percent > 0 ? "+" : ""}{row.diff_percent.toFixed(1)}%
                                  </span>
                                ) : (
                                  <span className="text-zinc-600">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </main>
    </div>
  );
}
