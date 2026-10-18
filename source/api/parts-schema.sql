CREATE TABLE IF NOT EXISTS parts_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
INSERT OR IGNORE INTO parts_migrations(version,applied_at) VALUES(1,CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS part_products (
 sku TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT NOT NULL, description TEXT NOT NULL,
 image TEXT NOT NULL, system TEXT NOT NULL, category TEXT NOT NULL, price_cents INTEGER CHECK(price_cents>0),
 moq INTEGER CHECK(moq>0), supply_status TEXT NOT NULL, commercial_evidence TEXT NOT NULL,
 published INTEGER NOT NULL DEFAULT 0 CHECK(published IN(0,1)), source TEXT NOT NULL,
 verified_at TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS part_numbers (
 id INTEGER PRIMARY KEY, sku TEXT NOT NULL REFERENCES part_products(sku), kind TEXT NOT NULL CHECK(kind IN('oem','manufacturer','cross')),
 brand TEXT NOT NULL, number TEXT NOT NULL, normalized TEXT NOT NULL, source TEXT NOT NULL, verified_at TEXT NOT NULL,
 UNIQUE(sku,kind,brand,normalized)
);
CREATE INDEX IF NOT EXISTS part_number_lookup ON part_numbers(normalized,sku);
CREATE TABLE IF NOT EXISTS part_vehicles (
 id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK(type IN('auto','moto')), make TEXT NOT NULL, model TEXT NOT NULL,
 year INTEGER NOT NULL, engine TEXT NOT NULL, UNIQUE(type,make,model,year,engine)
);
CREATE TABLE IF NOT EXISTS part_fitments (
 sku TEXT NOT NULL REFERENCES part_products(sku), vehicle_id INTEGER NOT NULL REFERENCES part_vehicles(id),
 source TEXT NOT NULL, verified_at TEXT NOT NULL, PRIMARY KEY(sku,vehicle_id)
);
CREATE INDEX IF NOT EXISTS fitment_vehicle_lookup ON part_fitments(vehicle_id,sku);
CREATE TABLE IF NOT EXISTS sourcing_requests (
 number TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL,
 document TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'received', version INTEGER NOT NULL DEFAULT 1,
 linked_order TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sourcing_files (
 id TEXT PRIMARY KEY, request_number TEXT NOT NULL REFERENCES sourcing_requests(number),
 disk_name TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS parts_audit (
 id INTEGER PRIMARY KEY, event TEXT NOT NULL, reference TEXT NOT NULL, document TEXT NOT NULL,
 actor TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sourcing_rates (sender TEXT PRIMARY KEY, count INTEGER NOT NULL, until_time INTEGER NOT NULL);
