'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/context/UserContext';
import { useToast } from '@/context/ToastContext';

type DurationMode = '7d' | '14d' | '30d' | 'custom';

interface HistorySeason {
    season_key: string;
    start: string;
    end: string;
    finalized_at: string;
}

interface HistoryEntry {
    posicion: number;
    usuario_id: number;
    usuario_nombre: string;
    completados: number;
    traductor: number;
    redrawer: number;
    typer: number;
}

interface RankingEntry {
    usuario_id: number;
    usuario_nombre: string;
    avatar_url?: string | null;
    grupo_id?: number | null;
    traductor: number;
    redrawer: number;
    typer: number;
    completados: number;
    posicion: number;
}

interface RankingResponse {
    canConfigure: boolean;
    isPreview: boolean;
    hasActiveSeason: boolean;
    seasonClosed?: boolean;
    rankingHidden?: boolean;
    forceFinalized?: boolean;
    timeContext?: {
        mexicoNow: string;
        serverNow: string;
        serverTimeZone: string;
        rankingTimeZone: string;
    };
    range: {
        start: string;
        end: string;
    } | null;
    officialRange: {
        start: string;
        end: string;
    } | null;
    total: number;
    ranking: RankingEntry[];
    finalTop6?: RankingEntry[];
}

function toISODate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): Date {
    const next = new Date(base);
    next.setDate(next.getDate() + days);
    return next;
}

function getRangeByMode(mode: Exclude<DurationMode, 'custom'>) {
    const end = new Date();
    if (mode === '7d') return { start: toISODate(addDays(end, -6)), end: toISODate(end) };
    if (mode === '14d') return { start: toISODate(addDays(end, -13)), end: toISODate(end) };
    return { start: toISODate(addDays(end, -29)), end: toISODate(end) };
}

function detectDurationMode(start: string, end: string, startTime: string, endTime: string): DurationMode {
    if (!start || !end) return '30d';
    if (startTime !== '00:00' || endTime !== '23:59') return 'custom';

    const startDate = new Date(`${start}T00:00:00`);
    const endDate = new Date(`${end}T00:00:00`);
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = Math.round(diffMs / 86400000) + 1;

    if (diffDays === 7) return '7d';
    if (diffDays === 14) return '14d';
    if (diffDays === 30) return '30d';
    return 'custom';
}

function durationLabel(mode: DurationMode) {
    if (mode === '30d') return 'Mensual';
    if (mode === '14d') return 'Quincenal';
    if (mode === '7d') return 'Semanal';
    return 'Personalizado';
}

function roleLabel(row: RankingEntry) {
    const pairs = [
        { key: 'Traductor', value: row.traductor },
        { key: 'Redrawer', value: row.redrawer },
        { key: 'Typer', value: row.typer },
    ];
    pairs.sort((a, b) => b.value - a.value);
    return pairs[0].value > 0 ? pairs[0].key : 'Sin rol dominante';
}

function badgeByPosition(position: number) {
    if (position === 1) return 'MVP';
    if (position === 2) return 'TOP 2';
    if (position === 3) return 'TOP 3';
    return `#${position}`;
}

function podiumNameClass(position: number) {
    if (position === 1) return 'ranking-name-1';
    if (position === 2) return 'ranking-name-2';
    return 'ranking-name-3';
}

function podiumScoreClass(position: number) {
    if (position === 1) return 'ranking-score-1';
    if (position === 2) return 'ranking-score-2';
    return 'ranking-score-3';
}

function extractDate(datetime: string): string {
    return datetime.slice(0, 10);
}

function extractTime(datetime: string): string {
    if (datetime.length > 10) return datetime.slice(11, 16);
    return '';
}

function formatDisplayDate(dateStr: string): string {
    if (!dateStr) return '';
    const date = dateStr.slice(0, 10);
    const parts = date.split('-');
    if (parts.length !== 3) return dateStr;
    const time = dateStr.length > 10 ? ' ' + dateStr.slice(11, 16) : '';
    return `${parts[2]}/${parts[1]}/${parts[0]}${time}`;
}

function formatDisplayDateTime12(dateStr: string): string {
    if (!dateStr) return '';
    const date = dateStr.slice(0, 10);
    const parts = date.split('-');
    if (parts.length !== 3) return dateStr;
    const rawTime = dateStr.length > 10 ? dateStr.slice(11, 19) : '00:00:00';
    const [hourStr = '00', minute = '00', second = '00'] = rawTime.split(':');
    const hour24 = Number(hourStr);
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return `${parts[2]}/${parts[1]}/${parts[0]} ${String(hour12).padStart(2, '0')}:${minute}:${second} ${suffix}`;
}

export default function RankingPage() {
    const { user, loading: userLoading } = useUser();
    const router = useRouter();
    const { showToast } = useToast();
    const roles = user?.roles || [];
    const isLeader = roles.includes('Lider de Grupo');

    useEffect(() => {
        if (userLoading || !user) return;
        if (!user.isAdmin && !isLeader && (user.rango ?? 1) < 2) {
            router.replace('/asignaciones');
        }
    }, [userLoading, user, isLeader, router]);
    const canManageGroupVisibility = Boolean(user?.grupo_id && (user?.isAdmin || roles.includes('Administrador') || roles.includes('Lider de Grupo')));
    const [canConfigure, setCanConfigure] = useState(false);
    const [duration, setDuration] = useState<DurationMode>('30d');
    const [startDate, setStartDate] = useState<string>('');
    const [startTime, setStartTime] = useState<string>('00:00');
    const [endDate, setEndDate] = useState<string>('');
    const [endTime, setEndTime] = useState<string>('23:59');
    const [officialStartDate, setOfficialStartDate] = useState<string>('');
    const [officialStartTime, setOfficialStartTime] = useState<string>('');
    const [officialEndDate, setOfficialEndDate] = useState<string>('');
    const [officialEndTime, setOfficialEndTime] = useState<string>('');
    const [mexicoNow, setMexicoNow] = useState<string>('');
    const [serverNow, setServerNow] = useState<string>('');
    const [serverTimeZone, setServerTimeZone] = useState<string>('');
    const [rankingTimeZone, setRankingTimeZone] = useState<string>('America/Mexico_City');
    const [ranking, setRanking] = useState<RankingEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>('');
    const [isPreview, setIsPreview] = useState(false);
    const [hasActiveSeason, setHasActiveSeason] = useState(false);
    const [seasonClosed, setSeasonClosed] = useState(false);
    const [rankingHidden, setRankingHidden] = useState(false);
    const [forceFinalized, setForceFinalized] = useState(false);
    const [finalTop6, setFinalTop6] = useState<RankingEntry[]>([]);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historySeasons, setHistorySeasons] = useState<HistorySeason[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [modalLoading, setModalLoading] = useState(false);
    const [modalSeason, setModalSeason] = useState<{ start: string; end: string } | null>(null);
    const [modalEntries, setModalEntries] = useState<HistoryEntry[]>([]);
    const groupRankingVisible = user?.groupSettings?.showRanking !== false;
    const canViewRanking = Boolean(user?.isAdmin || roles.includes('Administrador') || isLeader || groupRankingVisible);

    if (user && !canViewRanking && !canManageGroupVisibility) {
        return (
            <div className="flex-1 flex items-center justify-center bg-background-dark text-muted-dark p-6">
                El ranking esta oculto para este grupo.
            </div>
        );
    }

    const topThree = useMemo(() => ranking.slice(0, 3), [ranking]);
    const tableEntries = useMemo(() => ranking.slice(3), [ranking]);
    const maxCompleted = useMemo(() => Math.max(...ranking.map((entry) => entry.completados), 1), [ranking]);
    const hotZonePositions = useMemo(() => {
        const zone = ranking.filter((entry) => entry.posicion >= 4 && entry.posicion <= 6);
        const hot = new Set<number>();
        for (let i = 0; i < zone.length - 1; i += 1) {
            const current = zone[i];
            const next = zone[i + 1];
            if (Math.abs(current.completados - next.completados) <= 1) {
                hot.add(current.posicion);
                hot.add(next.posicion);
            }
        }
        return hot;
    }, [ranking]);

    const loadRanking = async (previewRange?: { start: string; end: string }) => {
        setLoading(true);
        setError('');
        try {
            const query = previewRange ? `?start=${encodeURIComponent(previewRange.start)}&end=${encodeURIComponent(previewRange.end)}` : '';
            const res = await fetch(`/api/ranking${query}`);
            const data: RankingResponse | { error?: string } = await res.json();

            if (!res.ok) {
                setRanking([]);
                setError((data as { error?: string }).error || 'No se pudo cargar el ranking.');
                return;
            }

            const typed = data as RankingResponse;
            setCanConfigure(Boolean(typed.canConfigure));
            setRanking(typed.ranking || []);
            setIsPreview(Boolean(typed.isPreview));
            setHasActiveSeason(Boolean(typed.hasActiveSeason));
            setSeasonClosed(Boolean(typed.seasonClosed));
            setRankingHidden(Boolean(typed.rankingHidden));
            setForceFinalized(Boolean(typed.forceFinalized));
            setFinalTop6(Array.isArray(typed.finalTop6) ? typed.finalTop6 : []);
            setMexicoNow(String(typed.timeContext?.mexicoNow || ''));
            setServerNow(String(typed.timeContext?.serverNow || ''));
            setServerTimeZone(String(typed.timeContext?.serverTimeZone || ''));
            setRankingTimeZone(String(typed.timeContext?.rankingTimeZone || 'America/Mexico_City'));
            const rawStart = typed.officialRange?.start || '';
            const rawEnd = typed.officialRange?.end || '';
            setOfficialStartDate(extractDate(rawStart));
            setOfficialStartTime(extractTime(rawStart));
            setOfficialEndDate(extractDate(rawEnd));
            setOfficialEndTime(extractTime(rawEnd));

            if (!previewRange) {
                if (rawStart && rawEnd) {
                    const nextStartDate = extractDate(rawStart);
                    const nextStartTime = extractTime(rawStart) || '00:00';
                    const nextEndDate = extractDate(rawEnd);
                    const nextEndTime = extractTime(rawEnd) || '23:59';
                    setStartDate(nextStartDate);
                    setStartTime(nextStartTime);
                    setEndDate(nextEndDate);
                    setEndTime(nextEndTime);
                    setDuration(detectDurationMode(nextStartDate, nextEndDate, nextStartTime, nextEndTime));
                } else {
                    const fallback = getRangeByMode('30d');
                    setStartDate(fallback.start);
                    setStartTime('00:00');
                    setEndDate(fallback.end);
                    setEndTime('23:59');
                    setDuration('30d');
                }
            }
        } catch {
            setRanking([]);
            setError('Error de red al cargar ranking.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadRanking();
    }, []);

    useEffect(() => {
        const onRealtimeUpdate = (event: Event) => {
            const detail = (event as CustomEvent<{ type?: string }>).detail;
            const type = String(detail?.type || '').toLowerCase();
            if (type === 'ranking' || type === 'assignment' || type === 'project') {
                loadRanking();
            }
        };
        window.addEventListener('realtime:update', onRealtimeUpdate);
        return () => {
            window.removeEventListener('realtime:update', onRealtimeUpdate);
        };
    }, []);

    useEffect(() => {
        if (!canConfigure || duration === 'custom') return;
        const range = getRangeByMode(duration);
        setStartDate(range.start);
        setEndDate(range.end);
    }, [duration, canConfigure]);

    const handlePreview = async () => {
        if (!startDate || !endDate) return;
        const startValue = startTime ? `${startDate} ${startTime}` : startDate;
        const endValue = endTime ? `${endDate} ${endTime}` : endDate;
        await loadRanking({ start: startValue, end: endValue });
    };

    const handleSave = async () => {
        if (!startDate || !endDate) return;
        const startValue = startTime ? `${startDate} ${startTime}` : startDate;
        const endValue = endTime ? `${endDate} ${endTime}` : endDate;
        setSaving(true);
        try {
            const res = await fetch('/api/ranking', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ start: startValue, end: endValue }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(data?.error || 'No se pudo guardar el periodo del ranking.', 'error');
                return;
            }
            showToast('Periodo oficial del ranking actualizado.', 'success');
            setDuration('custom');
            await loadRanking();
        } catch {
            showToast('Error de red al guardar la configuracion del ranking.', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleSetVisibility = async (hidden: boolean) => {
        setSaving(true);
        try {
            const res = await fetch('/api/ranking', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set_visibility', hidden }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(data?.error || 'No se pudo actualizar visibilidad.', 'error');
                return;
            }
            showToast(hidden ? 'Ranking oculto para todos.' : 'Ranking visible para todos.', 'success');
            await loadRanking();
        } catch {
            showToast('Error de red al actualizar visibilidad.', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleSetGroupVisibility = async (hidden: boolean) => {
        setSaving(true);
        try {
            const res = await fetch('/api/ranking', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set_visibility_group', hidden }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(data?.error || 'No se pudo actualizar la visibilidad del grupo.', 'error');
                return;
            }
            showToast(hidden ? 'Ranking oculto para el staff de este grupo.' : 'Ranking visible para el staff de este grupo.', 'success');
            window.location.reload();
        } catch {
            showToast('Error de red al actualizar visibilidad del grupo.', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleFinalize = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/ranking', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'finalize' }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(data?.error || 'No se pudo finalizar ranking.', 'error');
                return;
            }
            showToast('Ranking finalizado.', 'success');
            await loadRanking();
        } catch {
            showToast('Error de red al finalizar ranking.', 'error');
        } finally {
            setSaving(false);
        }
    };

    const loadHistory = async () => {
        setHistoryLoading(true);
        try {
            const res = await fetch('/api/ranking?action=history');
            const data = await res.json();
            setHistorySeasons(data.seasons || []);
        } catch {
            // ignore
        } finally {
            setHistoryLoading(false);
        }
    };

    const openSeasonModal = async (seasonKey: string, start: string, end: string) => {
        setModalSeason({ start, end });
        setModalOpen(true);
        setModalLoading(true);
        setModalEntries([]);
        try {
            const res = await fetch(`/api/ranking?action=history&season_key=${encodeURIComponent(seasonKey)}`);
            const data = await res.json();
            setModalEntries(data.entries || []);
        } catch {
            // ignore
        } finally {
            setModalLoading(false);
        }
    };

    const handleDeleteSeason = async (seasonKey: string) => {
        if (!confirm('¿Eliminar este registro de historial? Esta acción no se puede deshacer.')) return;
        try {
            const res = await fetch('/api/ranking', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete_season', season_key: seasonKey }),
            });
            if (!res.ok) {
                const data = await res.json();
                showToast(data?.error || 'No se pudo eliminar la temporada.', 'error');
                return;
            }
            setHistorySeasons((prev) => prev.filter((s) => s.season_key !== seasonKey));
            showToast('Temporada eliminada del historial.', 'success');
        } catch {
            showToast('Error de red al eliminar la temporada.', 'error');
        }
    };

    const handleToggleHistory = () => {
        const next = !historyOpen;
        setHistoryOpen(next);
        if (next && historySeasons.length === 0) {
            loadHistory();
        }
    };

    const champion = topThree[0];
    const secondPlace = topThree[1];
    const thirdPlace = topThree[2];
    const selfFinalPosition = useMemo(
        () => finalTop6.find((item) => Number(item.usuario_id) === Number(user?.id)) || null,
        [finalTop6, user?.id]
    );

    return (
        <div className="flex-1 flex flex-col h-full bg-background-dark overflow-hidden">
            <header className="h-20 bg-surface-dark border-b border-gray-800 hidden md:flex items-center justify-between px-6 lg:px-8 z-10 sticky top-0 shrink-0">
                <h1 className="font-display font-bold text-2xl lg:text-3xl uppercase tracking-wider text-white">
                    <span className="text-primary">Ranking</span> de Colaboradores
                </h1>
                <Link
                    href="/"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-200 hover:border-primary hover:text-primary transition-colors"
                >
                    <span className="material-icons-round text-base">dashboard</span>
                    Dashboard
                </Link>
            </header>

            <div className="flex-1 overflow-y-auto p-4 lg:p-8 pb-32 md:pb-8">
                <div className="max-w-6xl mx-auto space-y-6">
                    <section className="relative overflow-hidden rounded-2xl border border-gray-800 bg-gradient-to-b from-[#1b1418] via-[#120f14] to-[#0f0d11] p-4 md:p-6">
                        <div className="pointer-events-none absolute inset-0 ranking-stars"></div>
                        <div className="relative z-10">
                            <div className="flex items-center justify-between gap-3 mb-4">
                                <div>
                                    <p className="text-xs font-bold tracking-[0.3em] uppercase text-primary/80">Temporada Actual</p>
                                    <h2 className="text-xl md:text-2xl text-white font-display font-bold uppercase tracking-wide">Ranking de Colaboradores</h2>
                                    {officialStartDate && officialEndDate && (
                                        <p className="text-sm text-muted-dark mt-1">
                                            Periodo oficial: <span className="text-gray-100 font-semibold">
                                                {formatDisplayDate(officialStartDate)}{officialStartTime ? ` ${officialStartTime}` : ''} a {formatDisplayDate(officialEndDate)}{officialEndTime ? ` ${officialEndTime}` : ''}
                                            </span>
                                        </p>
                                    )}
                                </div>
                            </div>

                            {(canConfigure || canManageGroupVisibility) && (
                                <div className="mb-4 rounded-2xl border border-gray-700/80 bg-black/25 p-4 md:p-5">
                                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                                        <div>
                                            <p className="text-xs uppercase tracking-[0.22em] font-bold text-primary/80">Centro de Control</p>
                                            <h3 className="mt-1 text-lg font-display font-bold uppercase tracking-wide text-white">
                                                {canConfigure ? 'Configuracion de Temporada' : 'Control de Visibilidad'}
                                            </h3>
                                            <p className="mt-1 text-sm text-muted-dark">
                                                {canConfigure
                                                    ? 'Ajusta el periodo oficial, revisa una vista previa y aplica el cierre cuando corresponda.'
                                                    : 'Administra si tu grupo puede ver o no el ranking oficial.'}
                                            </p>
                                        </div>
                                        {canConfigure && (
                                            <div className="flex flex-wrap gap-2">
                                                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-200">
                                                    <span className="material-icons-round text-sm">calendar_month</span>
                                                    {durationLabel(duration)}
                                                </span>
                                                {forceFinalized ? (
                                                    <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-200">
                                                        <span className="material-icons-round text-sm">workspace_premium</span>
                                                        Temporada cerrada
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-sky-200">
                                                        <span className="material-icons-round text-sm">schedule</span>
                                                        Temporada activa
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
                                        {canConfigure && (
                                            <div className="rounded-2xl border border-gray-700/70 bg-gradient-to-br from-white/[0.04] to-white/[0.02] p-4">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div>
                                                        <p className="text-[11px] uppercase tracking-[0.22em] font-bold text-gray-300">Periodo oficial</p>
                                                        <p className="mt-1 text-sm text-muted-dark">Mensual queda como preset principal, pero puedes afinar el rango manualmente.</p>
                                                    </div>
                                                </div>

                                                <div className="mt-4 grid gap-3 md:grid-cols-3">
                                                    <label className="block">
                                                        <span className="text-[10px] uppercase tracking-widest text-muted-dark font-bold">Duracion base</span>
                                                        <select
                                                            value={duration}
                                                            onChange={(e) => setDuration(e.target.value as DurationMode)}
                                                            className="mt-2 w-full bg-background-dark border border-gray-700 rounded-xl px-3 py-3 text-white text-sm"
                                                        >
                                                            <option value="30d">Mensual</option>
                                                            <option value="14d">Quincenal</option>
                                                            <option value="7d">Semanal</option>
                                                            <option value="custom">Personalizado</option>
                                                        </select>
                                                    </label>

                                                    <label className="block">
                                                        <span className="text-[10px] uppercase tracking-widest text-muted-dark font-bold">Inicio oficial</span>
                                                        <input
                                                            type="date"
                                                            value={startDate}
                                                            onChange={(e) => {
                                                                setDuration('custom');
                                                                setStartDate(e.target.value);
                                                            }}
                                                            className="mt-2 w-full bg-background-dark border border-gray-700 rounded-xl px-3 py-3 text-white text-sm"
                                                        />
                                                        <input
                                                            type="time"
                                                            value={startTime}
                                                            onChange={(e) => {
                                                                setDuration('custom');
                                                                setStartTime(e.target.value);
                                                            }}
                                                            className="mt-2 w-full bg-background-dark border border-gray-700 rounded-xl px-3 py-2 text-white text-sm"
                                                        />
                                                    </label>

                                                    <label className="block">
                                                        <span className="text-[10px] uppercase tracking-widest text-muted-dark font-bold">Cierre oficial</span>
                                                        <input
                                                            type="date"
                                                            value={endDate}
                                                            onChange={(e) => {
                                                                setDuration('custom');
                                                                setEndDate(e.target.value);
                                                            }}
                                                            className="mt-2 w-full bg-background-dark border border-gray-700 rounded-xl px-3 py-3 text-white text-sm"
                                                        />
                                                        <input
                                                            type="time"
                                                            value={endTime}
                                                            onChange={(e) => {
                                                                setDuration('custom');
                                                                setEndTime(e.target.value);
                                                            }}
                                                            className="mt-2 w-full bg-background-dark border border-gray-700 rounded-xl px-3 py-2 text-white text-sm"
                                                        />
                                                    </label>
                                                </div>

                                                <div className="mt-4 grid gap-3 md:grid-cols-2">
                                                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                                                        <p className="text-[10px] uppercase tracking-widest font-bold text-primary/80">Rango actual</p>
                                                        <p className="mt-1 text-sm font-semibold text-white">
                                                            {startDate ? formatDisplayDate(startDate) : '--'} {startTime || '00:00'}
                                                        </p>
                                                        <p className="text-sm font-semibold text-white">
                                                            a {endDate ? formatDisplayDate(endDate) : '--'} {endTime || '23:59'}
                                                        </p>
                                                    </div>
                                                    <div className="rounded-xl border border-gray-700 bg-black/20 p-3">
                                                        <p className="text-[10px] uppercase tracking-widest font-bold text-gray-300">Uso recomendado</p>
                                                        <p className="mt-1 text-sm text-muted-dark">
                                                            Usa <span className="text-white font-semibold">Vista previa</span> para revisar el conteo y luego <span className="text-white font-semibold">Aplicar periodo</span> para volverlo oficial.
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        <div className="space-y-3">
                                            {canConfigure && (
                                                <div className="rounded-2xl border border-gray-700/70 bg-gradient-to-br from-primary/[0.08] to-transparent p-4">
                                                    <p className="text-[11px] uppercase tracking-[0.22em] font-bold text-primary/80">Acciones principales</p>
                                                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        <button
                                                            onClick={handlePreview}
                                                            disabled={loading || !startDate || !endDate}
                                                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-600 bg-surface-darker px-4 py-3 text-sm font-bold text-white transition hover:border-sky-400/60 hover:text-sky-200 disabled:opacity-50"
                                                        >
                                                            <span className="material-icons-round text-base">visibility</span>
                                                            Vista previa
                                                        </button>
                                                        <button
                                                            onClick={handleSave}
                                                            disabled={saving || !startDate || !endDate}
                                                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white transition hover:bg-primary/90 disabled:opacity-50"
                                                        >
                                                            <span className="material-icons-round text-base">save</span>
                                                            {saving ? 'Aplicando...' : 'Aplicar periodo'}
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            <div className="rounded-2xl border border-gray-700/70 bg-gradient-to-br from-amber-500/[0.08] to-transparent p-4">
                                                <p className="text-[11px] uppercase tracking-[0.22em] font-bold text-gray-200">
                                                    {canConfigure ? 'Estado y Visibilidad' : 'Visibilidad de Grupo'}
                                                </p>
                                                <div className="mt-3 grid gap-3">
                                                    {canManageGroupVisibility && (
                                                        <button
                                                            onClick={() => handleSetGroupVisibility(groupRankingVisible)}
                                                            disabled={saving}
                                                            className="inline-flex items-center justify-between gap-3 rounded-xl border border-gray-600 bg-surface-darker px-4 py-3 text-left text-sm font-semibold text-white transition hover:border-primary/50 disabled:opacity-50"
                                                        >
                                                            <span>
                                                                {groupRankingVisible ? 'Ocultar para este grupo' : 'Mostrar para este grupo'}
                                                            </span>
                                                            <span className="material-icons-round text-base">
                                                                {groupRankingVisible ? 'visibility_off' : 'visibility'}
                                                            </span>
                                                        </button>
                                                    )}

                                                    {canConfigure && (
                                                        <>
                                                            <button
                                                                onClick={() => handleSetVisibility(!rankingHidden)}
                                                                disabled={saving}
                                                                className="inline-flex items-center justify-between gap-3 rounded-xl border border-gray-600 bg-surface-darker px-4 py-3 text-left text-sm font-semibold text-white transition hover:border-primary/50 disabled:opacity-50"
                                                            >
                                                                <span>{rankingHidden ? 'Mostrar ranking global' : 'Ocultar ranking global'}</span>
                                                                <span className="material-icons-round text-base">
                                                                    {rankingHidden ? 'public' : 'public_off'}
                                                                </span>
                                                            </button>

                                                            <button
                                                                onClick={handleFinalize}
                                                                disabled={saving || forceFinalized}
                                                                className="inline-flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-600/90 px-4 py-3 text-left text-sm font-bold text-white transition hover:bg-amber-500 disabled:opacity-50"
                                                            >
                                                                <span>{forceFinalized ? 'Temporada finalizada' : 'Cerrar temporada y fijar resultado'}</span>
                                                                <span className="material-icons-round text-base">flag</span>
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                                <p className="mt-3 text-xs text-muted-dark">
                                                    {canConfigure
                                                        ? 'Aplicar periodo solo actualiza el rango oficial. Cerrar temporada deja la clasificacion final registrada.'
                                                        : 'Este control solo afecta la visibilidad del ranking para el staff de tu grupo.'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {rankingHidden && (
                                <div className="mb-4 bg-amber-500/10 border border-amber-400/40 rounded-xl p-3 text-sm text-amber-200">
                                    {canConfigure ? 'El ranking esta oculto para todos los usuarios.' : 'El ranking esta temporalmente oculto.'}
                                </div>
                            )}

                            {!canConfigure && hasActiveSeason && officialStartDate && officialEndDate && (
                                <div className="mb-4 bg-black/20 border border-gray-700 rounded-xl p-3 text-sm text-gray-200">
                                    Mostrando ranking oficial del periodo <span className="font-semibold">{officialStartDate} a {officialEndDate}</span>.
                                </div>
                            )}

                            {(mexicoNow || serverNow || officialEndDate) && (
                                <div className="mb-4 rounded-2xl border border-gray-700 bg-black/20 p-4">
                                    <p className="text-xs uppercase tracking-[0.22em] font-bold text-gray-300">Comparacion de Horas</p>
                                    <p className="mt-1 text-xs text-muted-dark">Formato 12 horas</p>
                                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                                        {mexicoNow && (
                                            <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3">
                                                <p className="text-[10px] uppercase tracking-widest font-bold text-emerald-200">Hora MX</p>
                                                <p className="mt-1 text-sm font-semibold text-white">{formatDisplayDateTime12(mexicoNow)}</p>
                                                <p className="mt-1 text-[11px] text-emerald-100">{rankingTimeZone}</p>
                                            </div>
                                        )}
                                        {serverNow && (
                                            <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 p-3">
                                                <p className="text-[10px] uppercase tracking-widest font-bold text-sky-200">Hora Servidor</p>
                                                <p className="mt-1 text-sm font-semibold text-white">{formatDisplayDateTime12(serverNow)}</p>
                                                <p className="mt-1 text-[11px] text-sky-100">{serverTimeZone || 'server-local'}</p>
                                            </div>
                                        )}
                                        {officialEndDate && (
                                            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3">
                                                <p className="text-[10px] uppercase tracking-widest font-bold text-amber-200">Cierre Oficial</p>
                                                <p className="mt-1 text-sm font-semibold text-white">
                                                    {formatDisplayDateTime12(`${officialEndDate} ${officialEndTime || '23:59'}:00`)}
                                                </p>
                                                <p className="mt-1 text-[11px] text-amber-100">Se compara con hora MX</p>
                                            </div>
                                        )}
                                    </div>
                                    {officialEndDate && mexicoNow && (
                                        <p className="mt-3 text-sm text-gray-200">
                                            El cierre del ranking se compara con hora de <span className="font-semibold">{rankingTimeZone}</span>.
                                        </p>
                                    )}
                                </div>
                            )}

                            {seasonClosed && finalTop6.length > 0 && (
                                <div className="mb-4 bg-emerald-500/10 border border-emerald-400/40 rounded-xl p-4">
                                    <p className="text-xs uppercase tracking-[0.22em] font-bold text-emerald-200">Temporada Cerrada</p>
                                    <p className="text-sm text-emerald-100 mt-1">
                                        Clasificacion final registrada del {officialStartDate} al {officialEndDate}.
                                    </p>
                                </div>
                            )}

                            {isPreview && canConfigure && (
                                <div className="mb-4 bg-amber-500/10 border border-amber-400/40 rounded-xl p-3 text-sm text-amber-200">
                                    Vista previa con rango {startDate} a {endDate}. Aun no esta guardado como oficial.
                                </div>
                            )}

                            {loading ? (
                                <div className="rounded-2xl border border-gray-700 bg-black/20 p-8 animate-pulse h-64"></div>
                            ) : error ? (
                                <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-300 text-sm">{error}</div>
                            ) : !hasActiveSeason ? (
                                <div className="rounded-2xl border border-gray-700 bg-black/20 p-6 text-center">
                                    <p className="text-white font-semibold">Ranking próximamente</p>
                                    <p className="text-muted-dark text-sm mt-1">
                                        {canConfigure
                                            ? 'Define inicio y fin de temporada para activarlo.'
                                            : 'Aun no se ha iniciado una temporada oficial.'}
                                    </p>
                                </div>
                            ) : ranking.length === 0 ? (
                                <div className="rounded-2xl border border-gray-700 bg-black/20 p-6 text-center">
                                    <p className="text-white font-semibold">No hay completados para este periodo.</p>
                                    <p className="text-muted-dark text-sm mt-1">Prueba ampliando la fecha de inicio o fin.</p>
                                </div>
                            ) : (
                                <>
                                    <div className="mb-6">
                                        <div className="md:hidden">
                                            <div className="grid grid-cols-2 gap-2">
                                                {champion && (
                                                    <article className="col-span-2 group relative rounded-2xl p-3 text-center flex flex-col items-center ranking-card-in ranking-mobile-podium-card ranking-mobile-podium-gold">
                                                        <div className="ranking-podium-flare ranking-podium-flare-gold"></div>
                                                        <div className="relative z-10 mx-auto w-fit">
                                                            <div className="ranking-podium-crown-badge">
                                                                <span className="material-icons-round text-base text-amber-200">workspace_premium</span>
                                                            </div>
                                                            <div className="ranking-podium-avatar ranking-avatar-mobile ranking-avatar-1">
                                                                {champion.avatar_url ? (
                                                                    <img src={champion.avatar_url} alt={champion.usuario_nombre} className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <div className="ranking-avatar-fallback w-full h-full flex items-center justify-center text-white font-bold text-lg">
                                                                        {champion.usuario_nombre.slice(0, 1).toUpperCase()}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <p className="relative z-10 mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-300">Top 1</p>
                                                        <p className="relative z-10 text-[10px] font-bold uppercase ranking-mvp-fire mt-1">MVP</p>
                                                        <p className={`relative z-10 mt-2 text-[1.65rem] leading-tight font-display font-bold truncate ${podiumNameClass(1)}`}>{champion.usuario_nombre}</p>
                                                        <p className={`relative z-10 font-display text-[1.85rem] font-bold mt-1 ${podiumScoreClass(1)}`}>{champion.completados}</p>
                                                        <p className="relative z-10 text-[10px] uppercase text-muted-dark tracking-[0.2em]">Capitulos</p>
                                                    </article>
                                                )}

                                                {secondPlace && (
                                                    <article className="group relative rounded-2xl p-3 text-center flex flex-col items-center ranking-card-in ranking-mobile-podium-card ranking-mobile-podium-silver">
                                                        <div className="ranking-podium-flare ranking-podium-flare-silver"></div>
                                                        <div className="relative z-10 mx-auto w-fit">
                                                            <div className="ranking-podium-avatar ranking-avatar-mobile ranking-avatar-2">
                                                                {secondPlace.avatar_url ? (
                                                                    <img src={secondPlace.avatar_url} alt={secondPlace.usuario_nombre} className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <div className="ranking-avatar-fallback w-full h-full flex items-center justify-center text-white font-bold text-lg">
                                                                        {secondPlace.usuario_nombre.slice(0, 1).toUpperCase()}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <p className="relative z-10 mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-300">Top 2</p>
                                                        <p className={`relative z-10 mt-2 text-base leading-tight font-display font-bold truncate ${podiumNameClass(2)}`}>{secondPlace.usuario_nombre}</p>
                                                        <p className={`relative z-10 font-display text-[1.6rem] font-bold mt-1 ${podiumScoreClass(2)}`}>{secondPlace.completados}</p>
                                                        <p className="relative z-10 text-[10px] uppercase text-muted-dark tracking-[0.2em]">Capitulos</p>
                                                    </article>
                                                )}

                                                {thirdPlace && (
                                                    <article className="group relative rounded-2xl p-3 text-center flex flex-col items-center ranking-card-in ranking-mobile-podium-card ranking-mobile-podium-bronze">
                                                        <div className="ranking-podium-flare ranking-podium-flare-bronze"></div>
                                                        <div className="relative z-10 mx-auto w-fit">
                                                            <div className="ranking-podium-avatar ranking-avatar-mobile ranking-avatar-3">
                                                                {thirdPlace.avatar_url ? (
                                                                    <img src={thirdPlace.avatar_url} alt={thirdPlace.usuario_nombre} className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <div className="ranking-avatar-fallback w-full h-full flex items-center justify-center text-white font-bold text-lg">
                                                                        {thirdPlace.usuario_nombre.slice(0, 1).toUpperCase()}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <p className="relative z-10 mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-300">Top 3</p>
                                                        <p className={`relative z-10 mt-2 text-base leading-tight font-display font-bold truncate ${podiumNameClass(3)}`}>{thirdPlace.usuario_nombre}</p>
                                                        <p className={`relative z-10 font-display text-[1.6rem] font-bold mt-1 ${podiumScoreClass(3)}`}>{thirdPlace.completados}</p>
                                                        <p className="relative z-10 text-[10px] uppercase text-muted-dark tracking-[0.2em]">Capitulos</p>
                                                    </article>
                                                )}
                                            </div>
                                        </div>

                                        <div className="hidden md:grid grid-cols-3 gap-3 items-end ranking-podium-wrap">
                                            {secondPlace && (
                                                <article className="group ranking-podium-shape ranking-podium-shape-2 ranking-card-in ranking-podium-anim ranking-podium-anim-2">
                                                    <div className="ranking-podium-flare ranking-podium-flare-silver"></div>
                                                    <div className="ranking-podium-avatar-wrap">
                                                        <div className="ranking-podium-avatar ranking-avatar-2">
                                                            {secondPlace.avatar_url ? (
                                                                <img src={secondPlace.avatar_url} alt={secondPlace.usuario_nombre} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="ranking-avatar-fallback w-full h-full flex items-center justify-center text-white font-bold text-2xl">
                                                                    {secondPlace.usuario_nombre.slice(0, 1).toUpperCase()}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <span className="ranking-podium-rank ranking-rank-2">2</span>
                                                    </div>
                                                    <div className="ranking-podium-content">
                                                        <p className={`text-3xl font-display font-bold leading-none truncate ${podiumNameClass(2)}`}>{secondPlace.usuario_nombre}</p>
                                                        <p className={`text-lg font-display font-bold mt-2 ${podiumScoreClass(2)}`}>{secondPlace.completados}</p>
                                                        <p className="text-[11px] uppercase tracking-widest text-sky-200/80">Capitulos</p>
                                                    </div>
                                                </article>
                                            )}

                                            {champion && (
                                                <article className="group ranking-podium-shape ranking-podium-shape-1 ranking-card-in ranking-podium-anim ranking-podium-anim-1">
                                                    <div className="ranking-podium-flare ranking-podium-flare-gold"></div>
                                                    <div className="ranking-podium-avatar-wrap">
                                                        <div className="ranking-podium-crown-badge ranking-podium-crown-badge-desktop">
                                                            <span className="material-icons-round text-3xl text-amber-200">workspace_premium</span>
                                                        </div>
                                                        <div className="ranking-podium-avatar ranking-avatar-1">
                                                            {champion.avatar_url ? (
                                                                <img src={champion.avatar_url} alt={champion.usuario_nombre} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="ranking-avatar-fallback w-full h-full flex items-center justify-center text-white font-bold text-3xl">
                                                                    {champion.usuario_nombre.slice(0, 1).toUpperCase()}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <span className="ranking-podium-rank ranking-rank-1">1</span>
                                                    </div>
                                                    <div className="ranking-podium-content">
                                                        <p className="text-xs uppercase tracking-[0.28em] font-bold ranking-mvp-fire">MVP</p>
                                                        <p className={`text-4xl font-display font-bold leading-none mt-2 truncate ${podiumNameClass(1)}`}>{champion.usuario_nombre}</p>
                                                        <p className={`text-2xl font-display font-bold mt-3 ${podiumScoreClass(1)}`}>{champion.completados}</p>
                                                        <p className="text-[11px] uppercase tracking-widest text-amber-200/80">Capitulos realizados</p>
                                                    </div>
                                                </article>
                                            )}

                                            {thirdPlace && (
                                                <article className="group ranking-podium-shape ranking-podium-shape-3 ranking-card-in ranking-podium-anim ranking-podium-anim-3">
                                                    <div className="ranking-podium-flare ranking-podium-flare-bronze"></div>
                                                    <div className="ranking-podium-avatar-wrap">
                                                        <div className="ranking-podium-avatar ranking-avatar-3">
                                                            {thirdPlace.avatar_url ? (
                                                                <img src={thirdPlace.avatar_url} alt={thirdPlace.usuario_nombre} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="ranking-avatar-fallback w-full h-full flex items-center justify-center text-white font-bold text-2xl">
                                                                    {thirdPlace.usuario_nombre.slice(0, 1).toUpperCase()}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <span className="ranking-podium-rank ranking-rank-3">3</span>
                                                    </div>
                                                    <div className="ranking-podium-content">
                                                        <p className={`text-3xl font-display font-bold leading-none truncate ${podiumNameClass(3)}`}>{thirdPlace.usuario_nombre}</p>
                                                        <p className={`text-lg font-display font-bold mt-2 ${podiumScoreClass(3)}`}>{thirdPlace.completados}</p>
                                                        <p className="text-[11px] uppercase tracking-widest text-emerald-200/80">Capitulos</p>
                                                    </div>
                                                </article>
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        {tableEntries.map((entry) => {
                                            const progress = Math.max(4, Math.round((entry.completados / maxCompleted) * 100));
                                            const isSelf = Number(user?.id) === Number(entry.usuario_id);
                                            return (
                                                <article
                                                    key={entry.usuario_id}
                                                    className={`rounded-2xl border px-4 py-3 bg-surface-dark/95 transition-all ${isSelf ? 'border-primary/60 shadow-[0_0_18px_rgba(255,46,77,0.2)]' : 'border-gray-800'
                                                        }`}
                                                >
                                                    <div className="grid grid-cols-[2rem_2.75rem_minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 items-center sm:flex sm:items-center sm:gap-3">
                                                        <div className={`w-8 sm:w-10 text-center font-display font-bold text-lg ${entry.posicion <= 3 ? 'text-amber-300' : 'text-gray-300'}`}>
                                                            {entry.posicion}
                                                        </div>

                                                        <div className="w-11 h-11 rounded-full border border-gray-700 bg-surface-darker overflow-hidden shrink-0">
                                                            {entry.avatar_url ? (
                                                                <img src={entry.avatar_url} alt={entry.usuario_nombre} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-white font-bold">
                                                                    {entry.usuario_nombre.slice(0, 1).toUpperCase()}
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div className="min-w-0 sm:flex-1">
                                                            <div className="flex items-center gap-1 sm:gap-2 flex-wrap min-w-0">
                                                                <p className="text-white font-semibold truncate">{entry.usuario_nombre}</p>
                                                                {hotZonePositions.has(entry.posicion) && (
                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/20 border border-orange-400/50 text-orange-200 ranking-fire">
                                                                        <span className="material-icons-round text-xs">local_fire_department</span>
                                                                        <span className="sm:hidden">Pelea</span>
                                                                        <span className="hidden sm:inline">Top en pelea</span>
                                                                    </span>
                                                                )}
                                                                {isSelf && (
                                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/20 border border-primary/40 text-primary">
                                                                        <span className="sm:hidden">Tu</span>
                                                                        <span className="hidden sm:inline">Tu posicion</span>
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="h-1.5 w-full bg-gray-800 rounded-full mt-2 overflow-hidden">
                                                                <div className="h-full bg-gradient-to-r from-primary to-orange-400 rounded-full ranking-progress" style={{ width: `${progress}%` }}></div>
                                                            </div>
                                                            <p className="text-[11px] text-muted-dark mt-1 truncate">{roleLabel(entry)} - {badgeByPosition(entry.posicion)}</p>
                                                        </div>

                                                        <div className="text-right leading-none">
                                                            <p className="text-primary text-[1.75rem] sm:text-2xl font-display font-bold">{entry.completados}</p>
                                                            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-dark">caps</p>
                                                        </div>
                                                    </div>
                                                </article>
                                            );
                                        })}
                                    </div>

                                </>
                            )}
                        </div>
                    </section>

                    {/* History collapse */}
                    <section className="rounded-2xl border border-gray-800 bg-surface-dark/50 overflow-hidden">
                        <button
                            onClick={handleToggleHistory}
                            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-black/20 transition-colors"
                        >
                            <span className="flex items-center gap-2 text-sm font-bold text-gray-300 uppercase tracking-wider">
                                <span className="material-icons-round text-base text-muted-dark">history</span>
                                Historial de Temporadas
                            </span>
                            <span className="material-icons-round text-gray-500 text-base">
                                {historyOpen ? 'expand_less' : 'expand_more'}
                            </span>
                        </button>

                        {historyOpen && (
                            <div className="border-t border-gray-800 p-4">
                                {historyLoading ? (
                                    <div className="space-y-2">
                                        {[1, 2, 3].map((i) => (
                                            <div key={i} className="animate-pulse h-14 bg-black/20 rounded-xl" />
                                        ))}
                                    </div>
                                ) : historySeasons.length === 0 ? (
                                    <p className="text-sm text-muted-dark text-center py-3">No hay temporadas finalizadas anteriores.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {historySeasons.map((season) => (
                                            <div key={season.season_key} className="flex items-center gap-2">
                                                <button
                                                    onClick={() => openSeasonModal(season.season_key, season.start, season.end)}
                                                    className="flex-1 flex items-center justify-between rounded-xl border border-gray-700 bg-black/20 px-4 py-3 hover:border-primary/50 hover:bg-primary/5 transition-all group text-left"
                                                >
                                                    <div>
                                                        <p className="text-sm font-semibold text-white">
                                                            {formatDisplayDate(season.start)} — {formatDisplayDate(season.end)}
                                                        </p>
                                                        {season.finalized_at && (
                                                            <p className="text-xs text-muted-dark mt-0.5">
                                                                Finalizado el {formatDisplayDate(season.finalized_at.slice(0, 10))}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <span className="material-icons-round text-sm text-muted-dark group-hover:text-primary transition-colors shrink-0 ml-2">
                                                        emoji_events
                                                    </span>
                                                </button>
                                                {canConfigure && (
                                                    <button
                                                        onClick={() => handleDeleteSeason(season.season_key)}
                                                        className="p-2 rounded-lg border border-gray-700 bg-black/20 text-gray-500 hover:border-red-500/60 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
                                                        title="Eliminar temporada"
                                                    >
                                                        <span className="material-icons-round text-base">delete</span>
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </section>
                </div>

            {/* Season history modal */}
            {modalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setModalOpen(false)}>
                    <div className="relative w-full max-w-md rounded-2xl border border-gray-700 bg-surface-dark shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-gray-800">
                            <div>
                                <p className="text-xs uppercase tracking-widest font-bold text-primary/80">Temporada Finalizada</p>
                                {modalSeason && (
                                    <p className="text-base font-display font-bold text-white mt-0.5">
                                        {formatDisplayDate(modalSeason.start)} — {formatDisplayDate(modalSeason.end)}
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={() => setModalOpen(false)}
                                className="p-1 rounded-lg hover:bg-black/30 text-gray-400 hover:text-white transition-colors"
                            >
                                <span className="material-icons-round text-xl">close</span>
                            </button>
                        </div>

                        <div className="p-4 max-h-[28rem] overflow-y-auto">
                            {modalLoading ? (
                                <div className="space-y-2">
                                    {[1, 2, 3].map((i) => (
                                        <div key={i} className="animate-pulse h-11 bg-black/20 rounded-xl" />
                                    ))}
                                </div>
                            ) : modalEntries.length === 0 ? (
                                <p className="text-center text-sm text-muted-dark py-4">No hay datos para esta temporada.</p>
                            ) : (
                                <div className="space-y-2">
                                    {modalEntries.map((entry) => (
                                        <div
                                            key={entry.usuario_id}
                                            className="flex items-center gap-3 rounded-xl border border-gray-700 bg-black/20 px-3 py-2"
                                        >
                                            <span className={`w-7 text-center font-display font-bold text-sm shrink-0 ${entry.posicion <= 3 ? 'text-amber-300' : 'text-gray-400'}`}>
                                                #{entry.posicion}
                                            </span>
                                            <div className="w-8 h-8 rounded-full border border-gray-700 bg-surface-darker overflow-hidden shrink-0 flex items-center justify-center text-white text-xs font-bold">
                                                {entry.usuario_nombre.slice(0, 1).toUpperCase()}
                                            </div>
                                            <p className="flex-1 text-sm font-semibold text-white truncate">{entry.usuario_nombre}</p>
                                            <p className="text-sm font-bold text-primary shrink-0">{entry.completados} caps</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            </div>
        </div>
    );
}
