import { Home, Utensils, Receipt, ShoppingCart, Zap, Building } from 'lucide-react';

/**
 * Map of category name → icon component + Tailwind color classes.
 * Used in Dashboard (expense cards, filter tabs) and Balance (category breakdown).
 */
export const CATEGORY_MAP: Record<string, { icon: any, colorClass: string }> = {
    'Home':      { icon: Home,         colorClass: 'bg-primary/10 text-primary' },
    'Kitchen':   { icon: Utensils,     colorClass: 'bg-warning/10 text-warning' },
    'Groceries': { icon: ShoppingCart, colorClass: 'bg-success/10 text-success' },
    'Utilities': { icon: Zap,          colorClass: 'bg-cyan-500/10 text-cyan-500' },
    'Rent':      { icon: Building,     colorClass: 'bg-purple-500/10 text-purple-500' },
    'General':   { icon: Receipt,      colorClass: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
};

/**
 * Ordered list of all category names.
 * Used in ExpenseModal (category picker) and any filter UI.
 */
export const CATEGORIES: string[] = ['General', 'Home', 'Kitchen', 'Groceries', 'Utilities', 'Rent'];
