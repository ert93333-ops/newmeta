const BUDGET_MUTATION_KEYS = new Set([
  "budget",
  "daily_budget",
  "dailyBudget",
  "lifetime_budget",
  "lifetimeBudget",
  "bid_amount",
  "bidAmount",
  "spend_cap",
  "spendCap",
  "campaign_budget",
  "campaignBudget",
  "adset_budget",
  "adsetBudget",
  "budget_mutation",
  "budgetMutation"
]);

const BLOCKED_ACTION_WORDS = [
  "budget_change",
  "change_budget",
  "increase_budget",
  "decrease_budget",
  "set_budget",
  "update_budget",
  "예산변경",
  "예산 변경",
  "예산증액",
  "예산 증액",
  "예산감액",
  "예산 감액"
];

export class BudgetMutationBlockedError extends Error {
  readonly code = "BUDGET_MUTATION_HARD_BLOCKED";
  readonly paths: string[];

  constructor(paths: string[]) {
    super("예산 자동 변경은 이 시스템에서 실행할 수 없습니다. 추천만 가능합니다.");
    this.name = "BudgetMutationBlockedError";
    this.paths = paths;
  }
}

export function findBudgetMutationPaths(value: unknown, root = "$"): string[] {
  const paths: string[] = [];

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      paths.push(...findBudgetMutationPaths(item, `${root}[${index}]`));
    });
    return paths;
  }

  if (!value || typeof value !== "object") {
    return paths;
  }

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    const currentPath = `${root}.${key}`;
    const normalizedKey = key.toLowerCase();
    const stringValue = typeof nestedValue === "string" ? nestedValue.toLowerCase() : "";

    if (BUDGET_MUTATION_KEYS.has(key) || BUDGET_MUTATION_KEYS.has(normalizedKey)) {
      paths.push(currentPath);
    }

    if (key.toLowerCase() === "action" && BLOCKED_ACTION_WORDS.some((word) => stringValue.includes(word))) {
      paths.push(currentPath);
    }

    paths.push(...findBudgetMutationPaths(nestedValue, currentPath));
  }

  return paths;
}

export function assertNoBudgetMutation(value: unknown): void {
  const paths = findBudgetMutationPaths(value);
  if (paths.length > 0) {
    throw new BudgetMutationBlockedError(paths);
  }
}

export function isBudgetMutationBlockedError(error: unknown): error is BudgetMutationBlockedError {
  return error instanceof BudgetMutationBlockedError;
}
