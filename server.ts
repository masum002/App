import express from "express";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "data.json");

// --- LOCAL DATA STORAGE SETUP ---
interface DbSchema {
  users: any[];
  products: any[];
  orders: any[];
  coupons: any[];
}

function readDb(): DbSchema {
  if (!fs.existsSync(DATA_FILE)) {
    return { users: [], products: [], orders: [], coupons: [] };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

function writeDb(data: DbSchema) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- UTILS ---
const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "mahfujar003@gmail.com";

// --- SERVER SETUP ---
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());
  
  // Ensure public/uploads exists
  const uploadDir = path.join(__dirname, "public/uploads");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  
  app.use("/uploads", express.static(uploadDir));

  // --- MULTER SETUP ---
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
  });
  const upload = multer({ storage });

  // --- API ROUTES ---

  // Auth Routes
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password } = req.body;
      const db = readDb();
      if (db.users.find(u => u.email === email)) {
        return res.status(400).json({ error: "User already exists" });
      }
      
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = {
        _id: Date.now().toString(),
        email,
        password: hashedPassword,
        isAdmin: email === ADMIN_EMAIL, // AUTO ADMIN CHECK
        createdAt: new Date().toISOString()
      };
      
      db.users.push(newUser);
      writeDb(db);
      res.status(201).json({ message: "User registered successfully" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      const db = readDb();
      const user = db.users.find(u => u.email === email);
      
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      
      // Safety check: ensure admin flag is sync with current ADMIN_EMAIL setting
      if (email === ADMIN_EMAIL && !user.isAdmin) {
        user.isAdmin = true;
        writeDb(db);
      }

      const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, JWT_SECRET);
      res.json({ token, user: { email: user.email, isAdmin: user.isAdmin } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/auth/google-sync", async (req, res) => {
    try {
      const { email } = req.body;
      const db = readDb();
      let user = db.users.find(u => u.email === email);

      if (!user) {
        // Register new Google user
        user = {
          _id: Date.now().toString(),
          email,
          password: "GOOGLE_AUTH_USER", // Placeholder
          isAdmin: email === ADMIN_EMAIL,
          createdAt: new Date().toISOString()
        };
        db.users.push(user);
        writeDb(db);
      } else {
        // Sync admin status if necessary
        if (email === ADMIN_EMAIL && !user.isAdmin) {
          user.isAdmin = true;
          writeDb(db);
        }
      }

      const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, JWT_SECRET);
      res.json({ token, user: { email: user.email, isAdmin: user.isAdmin } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Product Routes
  app.get("/api/products", async (req, res) => {
    try {
      const { category } = req.query;
      const db = readDb();
      let products = db.products;
      if (category) {
        products = products.filter(p => p.category === category);
      }
      res.json(products);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/products", upload.single("image"), async (req: any, res: any) => {
    try {
      const { name, price, category, description, stock } = req.body;
      const imageUrl = req.file ? `/uploads/${req.file.filename}` : "";
      const db = readDb();
      const newProduct = {
        _id: Date.now().toString(),
        name,
        price: parseFloat(price),
        category,
        description,
        stock: parseInt(stock) || 0,
        image: imageUrl,
        createdAt: new Date().toISOString()
      };
      db.products.push(newProduct);
      writeDb(db);
      res.status(201).json(newProduct);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put("/api/products/:id", upload.single("image"), async (req: any, res: any) => {
    try {
      const { name, price, category, description, stock } = req.body;
      const db = readDb();
      const productIndex = db.products.findIndex(p => p._id === req.params.id);
      if (productIndex === -1) return res.status(404).json({ error: "Product not found" });

      const updatedProduct = {
        ...db.products[productIndex],
        name: name || db.products[productIndex].name,
        price: price ? parseFloat(price) : db.products[productIndex].price,
        category: category || db.products[productIndex].category,
        description: description || db.products[productIndex].description,
        stock: stock !== undefined ? parseInt(stock) : db.products[productIndex].stock,
        updatedAt: new Date().toISOString()
      };

      if (req.file) {
        updatedProduct.image = `/uploads/${req.file.filename}`;
      }

      db.products[productIndex] = updatedProduct;
      writeDb(db);
      res.json(updatedProduct);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/products/:id", async (req, res) => {
    try {
      const db = readDb();
      db.products = db.products.filter(p => p._id !== req.params.id);
      writeDb(db);
      res.json({ message: "Product deleted" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Order Routes
  app.post("/api/orders", async (req, res) => {
    try {
      const db = readDb();
      const { products: orderProducts } = req.body;

      // Check stock and reduce it
      for (const item of orderProducts) {
        const productIndex = db.products.findIndex(p => p._id === item.productId);
        if (productIndex !== -1) {
          if (db.products[productIndex].stock < item.quantity) {
            return res.status(400).json({ error: `Not enough stock for ${db.products[productIndex].name}` });
          }
          db.products[productIndex].stock -= item.quantity;
        }
      }

      const newOrder = {
        ...req.body,
        _id: Date.now().toString(),
        status: "Pending",
        createdAt: new Date().toISOString()
      };
      db.orders.push(newOrder);
      writeDb(db);
      res.status(201).json(newOrder);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/orders", async (req, res) => {
    try {
      const db = readDb();
      const orders = [...db.orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json(orders);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/orders/track/:id", async (req, res) => {
    try {
      const db = readDb();
      const order = db.orders.find(o => o._id === req.params.id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      res.json(order);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/orders/:id", async (req, res) => {
    try {
      const { status } = req.body;
      const db = readDb();
      const orderIndex = db.orders.findIndex(o => o._id === req.params.id);
      if (orderIndex === -1) return res.status(404).json({ error: "Order not found" });
      
      db.orders[orderIndex].status = status;
      db.orders[orderIndex].updatedAt = new Date().toISOString();
      writeDb(db);
      res.json(db.orders[orderIndex]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Coupon Routes
  app.get("/api/coupons", async (req, res) => {
    try {
      const db = readDb();
      res.json(db.coupons || []);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/coupons", async (req, res) => {
    try {
      const db = readDb();
      const newCoupon = { ...req.body, _id: Date.now().toString() };
      if (!db.coupons) db.coupons = [];
      db.coupons.push(newCoupon);
      writeDb(db);
      res.status(201).json(newCoupon);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin User Management
  app.get("/api/admin/users", async (req, res) => {
    try {
      const db = readDb();
      res.json(db.users.map(u => ({ _id: u._id, email: u.email, isAdmin: u.isAdmin })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/admin/users/:id/role", async (req, res) => {
    try {
      const { isAdmin } = req.body;
      const db = readDb();
      const userIndex = db.users.findIndex(u => u._id === req.params.id);
      if (userIndex === -1) return res.status(404).json({ error: "User not found" });
      
      db.users[userIndex].isAdmin = isAdmin;
      writeDb(db);
      res.json(db.users[userIndex]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Global Settings
  app.get("/api/settings", async (req, res) => {
    try {
      const db = readDb() as any;
      if (!db.settings) {
        db.settings = { announcement: "", heroText: "SMI ELECTRO HUB.", isMaintenance: false };
      }
      
      // Initialize shipping charges 
      if (!db.settings.shippingCharges) {
        db.settings.shippingCharges = {
          "Dhaka": 60, "Chattogram": 100, "Rajshahi": 100, "Khulna": 100, 
          "Barishal": 100, "Sylhet": 100, "Rangpur": 120, "Mymensingh": 100
        };
      }

      // Initialize payment accounts
      if (!db.settings.accounts) {
        db.settings.accounts = {
          bKash: { number: "017XXXXXXXX", type: "Personal" },
          Nagad: { number: "018XXXXXXXX", type: "Personal" }
        };
      }
      
      writeDb(db);
      res.json(db.settings);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const db = readDb() as any;
      db.settings = req.body;
      writeDb(db);
      res.json(db.settings);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 SMI Electro Hub server running at http://localhost:${PORT}`);
    console.log(`🛡️ Admin email configured: ${ADMIN_EMAIL}`);
  });
}

startServer();
