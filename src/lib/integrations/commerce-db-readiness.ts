export interface CommerceDbReadiness {
  status: "configured" | "partial" | "not_configured";
  sourceType?: string;
  connectionConfigured: boolean;
  tables: {
    orders?: string;
    customers?: string;
    products?: string;
  };
  missing: string[];
}

export function readCommerceDbReadiness(settings: unknown): CommerceDbReadiness {
  const record = isRecord(settings) ? settings : {};
  const sourceType = readString(record.sourceType);
  const connectionConfigured = record.connectionConfigured === true;
  const tables = isRecord(record.tables) ? record.tables : {};
  const orders = readString(tables.orders);
  const customers = readString(tables.customers);
  const products = readString(tables.products);
  const missing = [
    ...(!sourceType ? ["sourceType"] : []),
    ...(!connectionConfigured ? ["connectionConfigured"] : []),
    ...(!orders ? ["tables.orders"] : []),
    ...(!customers ? ["tables.customers"] : []),
    ...(!products ? ["tables.products"] : [])
  ];

  return {
    status: missing.length === 0 ? "configured" : missing.length === 5 ? "not_configured" : "partial",
    sourceType,
    connectionConfigured,
    tables: {
      orders,
      customers,
      products
    },
    missing
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
