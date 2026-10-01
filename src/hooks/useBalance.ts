import { useState, useEffect, useCallback, useRef } from 'react';
import { SettlementService } from '../services/settlementService';

export function useBalance(groupId: string | null, userId: string | null, category = 'All') {
    const [balance, setBalance] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const request = useRef(0);
    const recalculate = useCallback(async () => {
        const id = ++request.current;
        setLoading(true);
        try {
            if (!groupId || !userId) { setBalance(0); setError(null); return; }
            const report = await SettlementService.getCalculationExplanation(groupId, category);
            if (id !== request.current) return;
            if (report.issues.length) throw new Error(report.issues[0]);
            setBalance(report.memberRows.find((row) => row.userId === userId)?.netBalance ?? 0);
            setError(null);
        } catch (cause) {
            if (id === request.current) setError(cause instanceof Error ? cause.message : 'Calculation unavailable');
        } finally {
            if (id === request.current) setLoading(false);
        }
    }, [groupId, userId, category]);
    useEffect(() => {
        void recalculate();
        return () => { request.current += 1; };
    }, [recalculate]);
    return { balance, loading, error, recalculate };
}
