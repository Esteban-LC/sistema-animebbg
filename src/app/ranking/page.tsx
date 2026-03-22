'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
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

export default function RankingPage() {
    const { user } = useUser();
    const { showToast } = useToast();
    const [canConfigure, setCanConfigure] = useState(false);
    const [duration, setDuration] = useState<DurationMode>('custom');
    const [startDate, setStartDate] = useState<string>('');
    const [startTime, setStartTime] = useState<string>('00:00');
    const [endDate, setEndDate] = useState<string>('');
    const [endTime, setEndTime] = useState<string>('23:59');
    const [officialStartDate, setOfficialStartDate] = useState<string>('');
    const [officialStartTime, setOfficialStartTime] = useState<string>('');
    const [officialEndDate, setOfficialEndDate] = useState<string>('');
    const [officialEndTime, setOfficialEndTime] = useState<string>('');
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
            const rawStart = typed.officialRange?.start || '';
            const rawEnd = typed.officialRange?.end || '';
            setOfficialStartDate(extractDate(rawStart));
            setOfficialStartTime(extractTime(rawStart));
            setOfficialEndDate(extractDate(rawEnd));
            setOfficialEndTime(extractTime(rawEnd));

            if (!previewRange) {
                if (rawStart && rawEnd) {
                    setStartDate(extractDate(rawStart));
                    setStartTime(extractTime(rawStart) || '00:00');
                    setEndDate(extractDate(rawEnd));
                    setEndTime(extractTime(rawEnd) || '23:59');
                } else {
                    const fallback = getRangeByMode('7d');
                    setStartDate(fallback.start);
                    setStartTime('00:00');
                    setEndDate(fallback.end);
                    setEndTime('23:59');
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

                            {canConfigure && (
                                <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 mb-4">
                                    <label className="bg-black/20 border border-gray-700 rounded-xl p-3">
                                        <span className="text-[10px] uppercase tracking-widest text-muted-dark font-bold">Duracion</span>
                                        <select
                                            value={duration}
                                            onChange={(e) => setDuration(e.target.value as DurationMode)}
                                            className="mt-2 w-full bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                                        >
                                            <option value="7d">7 dias</option>
                                            <option value="14d">14 dias</option>
                                            <option value="30d">30 dias</option>
                                            <option value="custom">Personalizado</option>
                                        </select>
                                    </label>

                                    <label className="bg-black/20 border border-gray-700 rounded-xl p-3">
                                        <span className="text-[10px] uppercase tracking-widest text-muted-dark font-bold">Inicio</span>
                                        <input
                                            type="date"
                                            value={startDate}
                                            onChange={(e) => {
                                                setDuration('custom');
                                                setStartDate(e.target.value);
                                            }}
                                            className="mt-2 w-full bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                                        />
                                        <input
                                            type="time"
                                            value={startTime}
                                            onChange={(e) => {
                                                setDuration('custom');
                                                setStartTime(e.target.value);
                                            }}
                                            className="mt-1 w-full bg-background-dark border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm"
                                        />
                                    </label>

                                    <label className="bg-black/20 border border-gray-700 rounded-xl p-3">
                                        <span className="text-[10px] uppercase tracking-widest text-muted-dark font-bold">Fin</span>
                                        <input
                                            type="date"
                                            value={endDate}
                                            onChange={(e) => {
                                                setDuration('custom');
                                                setEndDate(e.target.value);
                                            }}
                                            className="mt-2 w-full bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                                        />
                                        <input
                                            type="time"
                                            value={endTime}
                                            onChange={(e) => {
                                                setDuration('custom');
                                                setEndTime(e.target.value);
                                            }}
                                            className="mt-1 w-full bg-background-dark border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm"
                                        />
                                    </label>

                                    <div className="bg-black/20 border border-gray-700 rounded-xl p-3 flex flex-col justify-center">
                                        <span className="text-[10px] uppercase tracking-widest text-muted-dark font-bold">Control admin</span>
                                        <div className="mt-2 flex gap-2">
                                            <button
                                                onClick={handlePreview}
                                                disabled={loading || !startDate || !endDate}
                                                className="px-3 py-2 rounded-lg text-xs font-bold bg-surface-darker border border-gray-600 text-white disabled:opacity-50"
                                            >
                                                Ver
                                            </button>
                                            <button
                                                onClick={handleSave}
                                                disabled={saving || !startDate || !endDate}
                                                className="px-3 py-2 rounded-lg text-xs font-bold bg-primary text-white disabled:opacity-50"
                                            >
                                                {saving ? 'Guardando...' : 'Guardar'}
                                            </button>
                                        </div>
                                        <div className="mt-2 flex gap-2">
                                            <button
                                                onClick={() => handleSetVisibility(!rankingHidden)}
                                                disabled={saving}
                                                className="px-3 py-2 rounded-lg text-xs font-bold bg-surface-darker border border-gray-600 text-white disabled:opacity-50"
                                            >
                                                {rankingHidden ? 'Mostrar' : 'Ocultar'}
                                            </button>
                                            <button
                                                onClick={handleFinalize}
                                                disabled={saving || forceFinalized}
                                                className="px-3 py-2 rounded-lg text-xs font-bold bg-amber-600 text-white disabled:opacity-50"
                                            >
                                                {forceFinalized ? 'Finalizado' : 'Finalizar'}
                                            </button>
                                        </div>
                                        <p className="text-xs text-muted-dark mt-2">Solo admin puede cambiar el periodo oficial.</p>
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

                                    {seasonClosed && finalTop6.length > 0 && (
                                        <section className="mt-8 rounded-2xl border border-gray-700 bg-black/20 p-4">
                                            <h3 className="text-lg md:text-xl font-display font-bold text-white uppercase tracking-wide">
                                                Top 6 Final de Temporada
                                            </h3>
                                            <div className="mt-3 space-y-2">
                                                {finalTop6.map((entry) => {
                                                    const isSelfFinal = Number(entry.usuario_id) === Number(user?.id);
                                                    return (
                                                        <div
                                                            key={`final-${entry.usuario_id}`}
                                                            className={`flex items-center justify-between rounded-xl border px-3 py-2 ${isSelfFinal
                                                                ? 'border-primary/50 bg-primary/10'
                                                                : 'border-gray-700 bg-surface-darker/80'
                                                                }`}
                                                        >
                                                            <div className="flex items-center gap-3 min-w-0">
                                                                <span className="w-8 text-center text-base font-display font-bold text-amber-200">#{entry.posicion}</span>
                                                                <p className="text-sm font-semibold text-white truncate">{entry.usuario_nombre}</p>
                                                            </div>
                                                            <p className="text-sm font-bold text-primary">{entry.completados} caps</p>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {selfFinalPosition && (
                                                <div className="mt-4 rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-4">
                                                    <p className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-200">Resultado Personal</p>
                                                    <p className="mt-1 text-lg font-display font-bold text-white">
                                                        Felicidades, quedaste Top {selfFinalPosition.posicion}
                                                    </p>
                                                    <p className="text-sm text-emerald-100 mt-1">
                                                        Cerraste la temporada con {selfFinalPosition.completados} capitulos completados.
                                                    </p>
                                                </div>
                                            )}
                                        </section>
                                    )}
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



