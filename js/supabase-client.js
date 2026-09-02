/**
 * TSATSAKPORNU POS - SUPABASE CLIENT & DATA ADAPTER
 * Provides direct Supabase Cloud backend integration with seamless offline/local demo fallback
 * and cross-device real-time synchronization.
 */

const STORAGE_KEYS = {
  SUPABASE_URL: 'ntoso_sb_url',
  SUPABASE_KEY: 'ntoso_sb_key',
  LOCAL_DB: 'ntoso_pos_db_v2',
  AUTH_SESSION: 'ntoso_pos_session'
};

// Empty defaults — real data synced with Supabase Cloud
const DEFAULT_PRODUCTS = [];
const DEFAULT_SALES = [];

function createUuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

class SupabaseDataService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.realtimeChannel = null;
    this.changeListeners = [];
    this.localDB = this.loadLocalDB();
  }

  loadLocalDB() {
    const saved = localStorage.getItem(STORAGE_KEYS.LOCAL_DB);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.products)) {
          return parsed;
        }
      } catch (e) {
        console.error('Error parsing local DB:', e);
      }
    }
    const initial = {
      products: DEFAULT_PRODUCTS,
      sales: DEFAULT_SALES,
      categories: ['All Items', 'Beverages', 'Groceries', 'Toiletries', 'School & Office', 'Provisions']
    };
    this.saveLocalDB(initial);
    return initial;
  }

  saveLocalDB(data) {
    if (data) this.localDB = data;
    localStorage.setItem(STORAGE_KEYS.LOCAL_DB, JSON.stringify(this.localDB));
  }

  getCredentials() {
    const localUrl = localStorage.getItem(STORAGE_KEYS.SUPABASE_URL);
    const localKey = localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY);
    const defaultConfig = window.DEFAULT_SUPABASE_CONFIG || {};

    const url = (localUrl || defaultConfig.url || '').trim();
    const key = (localKey || defaultConfig.key || '').trim();
    const isDefault = !localUrl && !!defaultConfig.url;

    return { url, key, isDefault };
  }

  async setCredentials(url, key) {
    url = (url || '').trim();
    key = (key || '').trim();
    if (url && key) {
      localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, url);
      localStorage.setItem(STORAGE_KEYS.SUPABASE_KEY, key);
    } else {
      localStorage.removeItem(STORAGE_KEYS.SUPABASE_URL);
      localStorage.removeItem(STORAGE_KEYS.SUPABASE_KEY);
    }
    return await this.initClient();
  }

  async initClient() {
    const creds = this.getCredentials();
    const url = creds.url;
    const key = creds.key;

    if (url && key && window.supabase) {
      try {
        this.client = window.supabase.createClient(url, key);
        // Test query
        const { data, error } = await this.client.from('products').select('count', { count: 'exact', head: true });
        if (!error) {
          this.isConnected = true;
          console.log('✅ Connected to Supabase backend successfully.');
          await this.migrateLegacyLocalData();
          this.setupRealtimeSubscriptions();
          return { success: true, mode: 'cloud' };
        } else {
          console.warn('Supabase query failed, using local mode:', error.message);
          this.isConnected = false;
          return { success: false, error: error.message, mode: 'local' };
        }
      } catch (err) {
        console.error('Failed to initialize Supabase client:', err);
        this.isConnected = false;
        return { success: false, error: err.message, mode: 'local' };
      }
    }

    this.isConnected = false;
    return { success: true, mode: 'local' };
  }

  async migrateLegacyLocalData() {
    if (!this.client) return;

    const productIdMap = new Map();
    const legacyProducts = this.localDB.products.filter(product => !isUuid(product.id));

    for (const product of legacyProducts) {
      const oldId = product.id;
      const newId = createUuid();
      const { error } = await this.client.from('products').upsert({ ...product, id: newId });
      if (error) {
        console.error('Could not migrate local product:', error.message);
      } else {
        product.id = newId;
        productIdMap.set(oldId, newId);
      }
    }

    if (productIdMap.size > 0) {
      for (const sale of this.localDB.sales) {
        for (const item of sale.items || []) {
          if (productIdMap.has(item.product_id)) item.product_id = productIdMap.get(item.product_id);
        }
      }
      this.saveLocalDB();
    }

    for (const sale of this.localDB.sales.filter(item => !isUuid(item.id))) {
      const saleId = createUuid();
      const { error: saleError } = await this.client.from('sales').insert({
        id: saleId,
        salesperson_id: isUuid(sale.salesperson_id) ? sale.salesperson_id : null,
        salesperson_name: sale.salesperson_name,
        customer_name: sale.customer_name,
        customer_phone: sale.customer_phone,
        total_revenue: sale.total_revenue,
        total_cost: sale.total_cost,
        net_profit: sale.net_profit,
        payment_method: sale.payment_method,
        notes: sale.notes,
        created_at: sale.created_at
      });

      if (saleError) {
        console.error('Could not migrate local sale:', saleError.message);
        continue;
      }

      sale.id = saleId;

      if (sale.items?.length) {
        const { error: itemError } = await this.client.from('sale_items').insert(sale.items.map(item => ({
          sale_id: saleId,
          product_id: isUuid(item.product_id) ? item.product_id : null,
          product_name: item.product_name,
          quantity: item.quantity,
          cost_price: item.cost_price,
          selling_price: item.selling_price,
          subtotal_revenue: item.subtotal_revenue,
          subtotal_cost: item.subtotal_cost,
          subtotal_profit: item.subtotal_profit
        })));
        if (itemError) console.error('Could not migrate local sale items:', itemError.message);
      }
    }

    this.saveLocalDB();
  }

  setupRealtimeSubscriptions() {
    if (!this.client || !this.isConnected) return;
    if (this.realtimeChannel) {
      try {
        this.client.removeChannel(this.realtimeChannel);
      } catch (e) {}
    }

    try {
      this.realtimeChannel = this.client.channel('tsatsakpornu_realtime_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
          console.log('⚡ Realtime Product update received from cloud:', payload);
          this.notifyChange('products', payload);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, (payload) => {
          console.log('⚡ Realtime Sales update received from cloud:', payload);
          this.notifyChange('sales', payload);
        })
        .subscribe((status) => {
          console.log('⚡ Supabase Realtime subscription status:', status);
        });
    } catch (e) {
      console.warn('Could not setup realtime subscriptions:', e);
    }
  }

  onDataChange(callback) {
    if (typeof callback === 'function') {
      this.changeListeners.push(callback);
    }
  }

  notifyChange(entity, payload) {
    for (const listener of this.changeListeners) {
      try {
        listener(entity, payload);
      } catch (e) {
        console.error('Data change listener error:', e);
      }
    }
  }

  /* ================= PRODUCTS CRUD ================= */
  async getProducts() {
    if (this.isConnected && this.client) {
      try {
        const { data, error } = await this.client
          .from('products')
          .select('*')
          .order('name', { ascending: true });
        if (!error && Array.isArray(data)) {
          this.localDB.products = data;
          this.saveLocalDB();
          return data;
        }
      } catch (e) {
        console.error('Cloud getProducts error, falling back:', e);
      }
    }
    return this.localDB.products;
  }

  async saveProduct(product) {
    if (!isUuid(product.id)) product.id = createUuid();
    product.cost_price = Number(product.cost_price) || 0;
    product.selling_price = Number(product.selling_price) || 0;
    product.stock = parseInt(product.stock) || 0;
    product.min_stock_alert = parseInt(product.min_stock_alert) || 5;

    // Save locally
    const idx = this.localDB.products.findIndex(p => p.id === product.id);
    if (idx >= 0) {
      this.localDB.products[idx] = { ...this.localDB.products[idx], ...product };
    } else {
      this.localDB.products.push(product);
    }
    this.saveLocalDB();

    // Sync to Supabase Cloud
    if (this.isConnected && this.client) {
      try {
        const { error } = await this.client
          .from('products')
          .upsert(product);
        if (error) {
          console.error('Cloud upsert product error:', error);
        } else {
          this.notifyChange('products', { event: 'upsert', product });
        }
      } catch (e) {
        console.error('Error syncing product to cloud:', e);
      }
    }

    return product;
  }

  async deleteProduct(productId) {
    this.localDB.products = this.localDB.products.filter(p => p.id !== productId);
    this.saveLocalDB();

    if (this.isConnected && this.client) {
      try {
        const { error } = await this.client.from('products').delete().eq('id', productId);
        if (!error) {
          this.notifyChange('products', { event: 'delete', productId });
        }
      } catch (e) {
        console.error('Error deleting product from cloud:', e);
      }
    }
    return true;
  }

  async uploadProductImage(file) {
    if (!file) return null;

    const fileExt = file.name.split('.').pop() || 'png';
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
    const filePath = `products/${fileName}`;

    if (this.isConnected && this.client) {
      try {
        const { data, error } = await this.client.storage
          .from('product-images')
          .upload(filePath, file, { cacheControl: '3600', upsert: true });

        if (error) {
          console.warn('Supabase storage upload error:', error);
          throw error;
        }

        const { data: publicUrlData } = this.client.storage
          .from('product-images')
          .getPublicUrl(filePath);

        return publicUrlData?.publicUrl || null;
      } catch (err) {
        console.error('Failed to upload to Supabase storage, using fallback:', err);
      }
    }

    // Fallback: convert to base64 Data URL for local storage
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  async deductStock(items) {
    for (const item of items) {
      const prod = this.localDB.products.find(p => p.id === item.product_id);
      if (prod) {
        prod.stock = Math.max(0, prod.stock - item.quantity);
        if (this.isConnected && this.client) {
          try {
            await this.client
              .from('products')
              .update({ stock: prod.stock })
              .eq('id', prod.id);
          } catch (e) {
            console.error('Error updating stock in cloud:', e);
          }
        }
      }
    }
    this.saveLocalDB();
  }

  /* ================= DATA RESET (WIPE EVERYTHING) ================= */
  async resetAllData() {
    // 1. Clear local storage
    this.localDB = {
      products: [],
      sales: [],
      categories: ['All Items', 'Beverages', 'Groceries', 'Toiletries', 'School & Office', 'Provisions']
    };
    this.saveLocalDB();

    // 2. Clear Supabase cloud tables if connected
    if (this.isConnected && this.client) {
      try {
        // Delete sale_items first (FK dependency)
        await this.client.from('sale_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        // Delete sales
        await this.client.from('sales').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        // Delete products
        await this.client.from('products').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        console.log('✅ Supabase cloud data cleared successfully.');
        this.notifyChange('reset', {});
      } catch (e) {
        console.error('Error clearing cloud data:', e);
      }
    }

    return true;
  }

  /* ================= SALES CRUD ================= */
  async getSales() {
    if (this.isConnected && this.client) {
      try {
        const { data, error } = await this.client
          .from('sales')
          .select(`
            *,
            sale_items (*)
          `)
          .order('created_at', { ascending: false });

        if (!error && Array.isArray(data)) {
          // Normalize items
          const normalized = data.map(s => ({
            ...s,
            items: s.sale_items || []
          }));
          this.localDB.sales = normalized;
          this.saveLocalDB();
          return normalized;
        }
      } catch (e) {
        console.error('Cloud getSales error, falling back:', e);
      }
    }
    return this.localDB.sales;
  }

  async recordSale(saleData) {
    // Computations
    const id = createUuid();
    const sale = {
      id,
      salesperson_id: saleData.salesperson_id || 'sales-default',
      salesperson_name: saleData.salesperson_name || 'Salesperson',
      customer_name: saleData.customer_name || 'Walk-in Customer',
      customer_phone: saleData.customer_phone || '',
      total_revenue: Number(saleData.total_revenue) || 0,
      total_cost: Number(saleData.total_cost) || 0,
      net_profit: Number(saleData.net_profit) || 0,
      payment_method: saleData.payment_method || 'cash',
      notes: saleData.notes || '',
      created_at: new Date().toISOString(),
      items: saleData.items || []
    };

    // Save locally & deduct stock
    this.localDB.sales.unshift(sale);
    await this.deductStock(sale.items);
    this.saveLocalDB();

    // Sync with Supabase cloud if connected
    if (this.isConnected && this.client) {
      try {
        const { data: insertedSale, error: saleErr } = await this.client
          .from('sales')
          .insert({
            salesperson_id: sale.salesperson_id.startsWith('user-') ? null : sale.salesperson_id,
            salesperson_name: sale.salesperson_name,
            customer_name: sale.customer_name,
            customer_phone: sale.customer_phone,
            total_revenue: sale.total_revenue,
            total_cost: sale.total_cost,
            net_profit: sale.net_profit,
            payment_method: sale.payment_method,
            notes: sale.notes,
            created_at: sale.created_at
          })
          .select()
          .single();

        if (!saleErr && insertedSale && sale.items.length > 0) {
          const itemsPayload = sale.items.map(it => ({
            sale_id: insertedSale.id,
            product_id: isUuid(it.product_id) ? it.product_id : null,
            product_name: it.product_name,
            quantity: it.quantity,
            cost_price: it.cost_price,
            selling_price: it.selling_price,
            subtotal_revenue: it.subtotal_revenue,
            subtotal_cost: it.subtotal_cost,
            subtotal_profit: it.subtotal_profit
          }));
          await this.client.from('sale_items').insert(itemsPayload);
          this.notifyChange('sales', { event: 'insert', sale });
        }
      } catch (e) {
        console.error('Error inserting sale to cloud:', e);
      }
    }

    return sale;
  }
}

// Global data service instance
window.dataService = new SupabaseDataService();
