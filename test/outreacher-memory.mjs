// In-memory stand-in for the service client used by machine-action tests.

export function createMemory(seed) {
  const db = {
    tables: structuredClone(seed.tables || {}),
    objects: seed.objects || [],
    rpc: seed.rpc || {}
  };
  function from(table) {
    return new Query(db, table);
  }
  return {
    db,
    from,
    schema(name) {
      return { from: (table) => from(name + "." + table) };
    },
    rpc(name, args) {
      const fn = db.rpc[name];
      if (!fn) return Promise.resolve({ data: null, error: { code: "42883", message: "function " + name + " does not exist" } });
      return Promise.resolve(fn(args, db));
    },
    storage: {
      from() {
        return {
          async createSignedUploadUrl(path) {
            return { data: { signedUrl: "https://uploads.example.test/" + path, token: "slot", path }, error: null };
          },
          async list(prefix) {
            return { data: db.objects.filter((item) => String(item.name).startsWith(prefix)), error: null };
          },
          async remove(paths) {
            db.objects = db.objects.filter((item) => !paths.includes(item.name));
            return { data: null, error: null };
          }
        };
      }
    }
  };
}

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.limitN = null;
    this.orderBy = null;
    this.payload = null;
    this.mode = "select";
  }
  select() { return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  order(column, options) { this.orderBy = { column, asc: !(options && options.ascending === false) }; return this; }
  limit(count) { this.limitN = count; return this; }
  update(payload) { this.mode = "update"; this.payload = payload; return this; }
  insert(payload) { this.mode = "insert"; this.payload = payload; return this; }
  maybeSingle() { return this.exec().then((result) => result.error ? result : { data: (result.data || [])[0] || null, error: null }); }
  then(resolve, reject) { return this.exec().then(resolve, reject); }
  exec() {
    if (!Object.prototype.hasOwnProperty.call(this.db.tables, this.table)) {
      return Promise.resolve({ data: null, error: { code: "42P01", message: "relation " + this.table + " does not exist" } });
    }
    const table = this.db.tables[this.table];
    if (this.mode === "insert") {
      const row = { ...(this.payload || {}) };
      table.push(row);
      return Promise.resolve({ data: row, error: null });
    }
    let rows = table.filter((row) => this.filters.every(([column, value]) => row[column] === value));
    if (this.mode === "update") {
      for (const row of rows) Object.assign(row, this.payload);
      return Promise.resolve({ data: rows, error: null });
    }
    if (this.orderBy) {
      const { column, asc } = this.orderBy;
      rows = [...rows].sort((left, right) => {
        if (left[column] === right[column]) return 0;
        return (left[column] > right[column] ? 1 : -1) * (asc ? 1 : -1);
      });
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return Promise.resolve({ data: rows, error: null });
  }
}
