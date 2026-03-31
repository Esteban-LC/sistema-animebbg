'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUser } from '@/context/UserContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Asignacion {
    id: number;
    usuario_id: number;
    rol: string;
    descripcion: string;
    estado: string;
    asignado_en: string;
    usuario_nombre: string;
    proyecto_titulo?: string;
    proyecto_imagen?: string;
    capitulo?: number;
}

interface Proyecto {
    id: number;
    titulo: string;
    tipo?: string;
    raw_secundario_activo?: number;
    estado?: string;
    imagen_url?: string;
    capitulos_actuales?: number;
    capitulos_totales?: number | null;
    grupo_id?: number | null;
}

interface CapituloOption {
    numero: number;
    status: 'disponible' | 'en_proceso' | 'completado' | 'no_realizado';
}

interface PeriodStats {
    total_asignaciones: number;
    pendientes: number;
    en_proceso: number;
    completadas: number;
    range?: {
        start: string;
        end: string;
    } | null;
}

const ROLE_OPTIONS = ['Traductor', 'Redrawer', 'Typer'];
const TRANSLATOR_ENG_ROLE = 'Traductor ENG';
const TRANSLATOR_KO_ROLE = 'Traductor KO';
const TRANSLATOR_JAP_ROLE = 'Traductor JAP';
const TRANSLATOR_CORE_LEGACY_ROLE = 'Traductor KO/JAP';
const PRODUCTION_ROLES = ['Traductor', 'Traductor ENG', 'Traductor KO', 'Traductor JAP', 'Traductor KO/JAP', 'Redrawer', 'Typer'];
type AssignMode = 'normal' | 'ruleta';

function resolveAvailableRoles(userRoles: string[]) {
    const roles = Array.isArray(userRoles) ? userRoles : [];
    const output = [];
    if (
        roles.includes('Traductor')
        || roles.includes(TRANSLATOR_ENG_ROLE)
        || roles.includes(TRANSLATOR_KO_ROLE)
        || roles.includes(TRANSLATOR_JAP_ROLE)
        || roles.includes(TRANSLATOR_CORE_LEGACY_ROLE)
    ) {
        output.push('Traductor');
    }
    if (roles.includes('Redrawer')) output.push('Redrawer');
    if (roles.includes('Typer')) output.push('Typer');
    return output.length > 0 ? output : ROLE_OPTIONS;
}

function getCoreTranslatorLabelByProjectType(tipo: string | undefined) {
    const normalized = String(tipo || '').toLowerCase();
    if (normalized === 'manga') return 'JAP';
    if (normalized === 'manhwa') return 'KO';
    return 'KO/JAP';
}

function getErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
}

function normalizeStatus(value: string | undefined) {
    return String(value || '').trim().toLowerCase();
}

export default function StaffPage() {
    const { user } = useUser();
    const { showToast } = useToast();
    const router = useRouter();

    const [asignaciones, setAsignaciones] = useState<Asignacion[]>([]);
    const [proyectos, setProyectos] = useState<Proyecto[]>([]);
    const [capitulos, setCapitulos] = useState<CapituloOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState<number | null>(null);
    const [filterStatus, setFilterStatus] = useState('todos');
    const [periodStats, setPeriodStats] = useState<PeriodStats | null>(null);

    const [selfForm, setSelfForm] = useState({
        proyecto_id: '',
        rol: '',
        traductor_tipo: 'ENG',
        capitulo: '',
    });
    const [assigning, setAssigning] = useState(false);
    const [assignMode, setAssignMode] = useState<AssignMode>('normal');

    const userRoles = useMemo(
        () => resolveAvailableRoles(user?.roles || []),
        [user?.roles]
    );
    const roleOptions = useMemo(
        () => (userRoles.length > 0 ? userRoles : ROLE_OPTIONS),
        [userRoles]
    );
    const roleOptionsKey = roleOptions.join('|');
    const selectedProject = proyectos.find((p) => String(p.id) === String(selfForm.proyecto_id));
    const coreTranslatorLabel = getCoreTranslatorLabelByProjectType(selectedProject?.tipo);
    const selfRoles = user?.roles || [];
    const selfHasTradCore =
        selfRoles.includes('Traductor')
        || selfRoles.includes(TRANSLATOR_KO_ROLE)
        || selfRoles.includes(TRANSLATOR_JAP_ROLE)
        || selfRoles.includes(TRANSLATOR_CORE_LEGACY_ROLE);
    const selfHasTradEng = selfRoles.includes(TRANSLATOR_ENG_ROLE);
    const canUseCoreTranslator = Number(selectedProject?.raw_secundario_activo || 0) === 1;
    const canUseCoreTranslatorForSelf = canUseCoreTranslator && selfHasTradCore;
    const isLeaderOnly =
        Boolean(selfRoles.includes('Lider de Grupo') || user?.role === 'Lider de Grupo');

    const fetchNextChapterOption = async (proyectoId: string, rol: string) => {
        if (!proyectoId || !rol) {
            setCapitulos([]);
            setSelfForm((prev) => ({ ...prev, capitulo: '' }));
            return;
        }

        try {
            const query = new URLSearchParams({ rol, mode: 'next' });
            if (rol === 'Traductor') query.set('traductor_tipo', selfForm.traductor_tipo || 'CORE');
            const res = await fetch(`/api/proyectos/${proyectoId}/capitulos?${query.toString()}`);
            const data = await res.json();
            const list = Array.isArray(data) ? data.filter((c: CapituloOption) => c.status === 'disponible') : [];
            setCapitulos(list);
            setSelfForm((prev) => ({
                ...prev,
                capitulo: list.length > 0 ? String(list[0].numero) : '',
            }));
        } catch {
            setCapitulos([]);
            setSelfForm((prev) => ({ ...prev, capitulo: '' }));
        }
    };

    const fetchAsignaciones = async () => {
        const res = await fetch('/api/asignaciones');
        const data = await res.json();
        if (!Array.isArray(data)) {
            setAsignaciones([]);
            return;
        }

        const roles = user?.roles || [];
        const canViewAll = user?.isAdmin || roles.includes('Administrador');
        if (canViewAll) {
            setAsignaciones(data);
        } else if (user?.id) {
            setAsignaciones(data.filter((a: Asignacion) => Number(a.usuario_id) === Number(user.id)));
        } else {
            setAsignaciones([]);
        }
    };

    const fetchPeriodStats = async () => {
        try {
            const res = await fetch('/api/estadisticas?scope=period');
            if (!res.ok) return;
            const data = await res.json();
            setPeriodStats({
                total_asignaciones: Number(data?.total_asignaciones || 0),
                pendientes: Number(data?.pendientes || 0),
                en_proceso: Number(data?.en_proceso || 0),
                completadas: Number(data?.completadas || 0),
                range: data?.range || null,
            });
        } catch {
            // silent fallback
        }
    };

    useEffect(() => {
        if (!user) return;
        Promise.all([
            fetchAsignaciones(),
            fetchPeriodStats(),
            fetch('/api/proyectos')
                .then((r) => r.json())
                .then((d) => {
                    const list = Array.isArray(d) ? d : [];
                    const activos = list.filter((p: Proyecto) => !['pausado', 'cancelado'].includes(normalizeStatus(p.estado)));
                    const scoped = user?.grupo_id
                        ? activos.filter((p: Proyecto) => Number(p.grupo_id) === Number(user.grupo_id))
                        : activos;
                    setProyectos(scoped.length > 0 ? scoped : activos);
                }),
        ]).finally(() => setLoading(false));
    }, [user]);

    useEffect(() => {
        if (!user) return;
        const id = window.setInterval(() => {
            fetchAsignaciones();
            fetchPeriodStats();
        }, 8000);
        const onRealtimeUpdate = () => {
            fetchAsignaciones();
            fetchPeriodStats();
        };
        window.addEventListener('realtime:update', onRealtimeUpdate);
        return () => {
            window.clearInterval(id);
            window.removeEventListener('realtime:update', onRealtimeUpdate);
        };
    }, [user?.id]);

    useEffect(() => {
        if (isLeaderOnly) return;

        setSelfForm((prev) => {
            const next = { ...prev };
            let changed = false;

            if (selfHasTradEng && !selfHasTradCore && prev.traductor_tipo !== 'ENG') {
                next.traductor_tipo = 'ENG';
                changed = true;
            } else if (selfHasTradCore && !selfHasTradEng && prev.traductor_tipo !== 'CORE') {
                next.traductor_tipo = 'CORE';
                changed = true;
            }

            if (roleOptions.length === 1 && prev.rol !== roleOptions[0]) {
                next.rol = roleOptions[0];
                changed = true;
            } else if (roleOptions.length > 1 && prev.rol && !roleOptions.includes(prev.rol)) {
                next.rol = '';
                changed = true;
            }

            return changed ? next : prev;
        });
    }, [roleOptionsKey, selfHasTradCore, selfHasTradEng]);

    useEffect(() => {
        if (isLeaderOnly) return;
        if (selfForm.rol !== 'Traductor') return;

        const currentType = selfForm.traductor_tipo;
        const canUseEng = selfHasTradEng;
        const canUseCore = selfHasTradCore && canUseCoreTranslatorForSelf;

        const currentIsValid =
            (currentType === 'ENG' && canUseEng)
            || (currentType === 'CORE' && canUseCore);

        if (currentIsValid) return;

        const nextType = canUseEng ? 'ENG' : canUseCore ? 'CORE' : currentType;
        if (nextType === currentType) return;

        setSelfForm((prev) => {
            if (prev.traductor_tipo === nextType) return prev;
            return { ...prev, traductor_tipo: nextType, capitulo: '' };
        });
    }, [selfForm.rol, selfForm.traductor_tipo, canUseCoreTranslatorForSelf, selfHasTradCore, selfHasTradEng]);

    useEffect(() => {
        if (!user || !isLeaderOnly) return;
        router.replace('/');
    }, [isLeaderOnly, router, user]);

    useEffect(() => {
        if (assignMode !== 'ruleta') return;
        setCapitulos([]);
        setSelfForm((prev) => ({ ...prev, proyecto_id: '', capitulo: '' }));
    }, [assignMode]);

    useEffect(() => {
        if (assignMode !== 'normal') {
            return;
        }

        if (!selfForm.proyecto_id || !selfForm.rol) {
            setCapitulos([]);
            setSelfForm((prev) => ({ ...prev, capitulo: '' }));
            return;
        }

        fetchNextChapterOption(selfForm.proyecto_id, selfForm.rol);
    }, [assignMode, selfForm.proyecto_id, selfForm.rol, selfForm.traductor_tipo]);

    const handleStatusUpdate = async (id: number, newStatus: string) => {
        setProcessingId(id);
        try {
            const res = await fetch(`/api/asignaciones/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ estado: newStatus }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'No se pudo actualizar');
            }
            await fetchAsignaciones();
            showToast('Estado actualizado', 'success');
        } catch (error: unknown) {
            showToast(getErrorMessage(error, 'Error al actualizar estado'), 'error');
        } finally {
            setProcessingId(null);
        }
    };

    const handleSelfAssignNormal = async () => {
        if (!user?.id || !selfForm.proyecto_id || !selfForm.rol || !selfForm.capitulo) return;
        setAssigning(true);
        try {
            const proyecto = proyectos.find((p) => String(p.id) === selfForm.proyecto_id);
            const descripcion = `${proyecto?.titulo || 'Proyecto'} - Capitulo ${selfForm.capitulo}`;
            const res = await fetch('/api/asignaciones', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    usuario_id: user.id,
                    proyecto_id: Number(selfForm.proyecto_id),
                    rol: selfForm.rol,
                    traductor_tipo: selfForm.rol === 'Traductor' ? selfForm.traductor_tipo : null,
                    capitulo: Number(selfForm.capitulo),
                    descripcion,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'No se pudo autoasignar');

            await fetchAsignaciones();
            await fetchNextChapterOption(selfForm.proyecto_id, selfForm.rol);
            showToast('Capitulo asignado', 'success');
        } catch (error: unknown) {
            showToast(getErrorMessage(error, 'Error'), 'error');
        } finally {
            setAssigning(false);
        }
    };

    const handleSelfAssignRoulette = async () => {
        if (!user?.id || !selfForm.rol) return;
        setAssigning(true);
        try {
            const res = await fetch('/api/asignaciones/auto', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    usuario_id: user.id,
                    rol: selfForm.rol,
                    traductor_tipo: selfForm.rol === 'Traductor' ? selfForm.traductor_tipo : undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'No se pudo tirar ruleta');

            await fetchAsignaciones();
            setSelfForm((prev) => ({ ...prev, proyecto_id: '', capitulo: '' }));
            setCapitulos([]);
            const proyectoLabel = data?.proyecto_titulo ? `${data.proyecto_titulo} - ` : '';
            showToast(`Ruleta asigno ${proyectoLabel}capitulo ${data.capitulo}`, 'success');
        } catch (error: unknown) {
            showToast(getErrorMessage(error, 'Error'), 'error');
        } finally {
            setAssigning(false);
        }
    };

    const filtered = asignaciones.filter(a => {
        if (filterStatus !== 'todos' && a.estado !== filterStatus) return false;
        return true;
    });
    const hasActiveSelfAssignment = useMemo(
        () => asignaciones.some((a) => Number(a.usuario_id) === Number(user?.id) && ['Pendiente', 'En Proceso'].includes(a.estado)),
        [asignaciones, user?.id]
    );
    const activeSelfAssignment = useMemo(
        () => asignaciones.find((a) => Number(a.usuario_id) === Number(user?.id) && ['Pendiente', 'En Proceso'].includes(a.estado)) || null,
        [asignaciones, user?.id]
    );

    const getRoleIcon = (role: string) => {
        switch (role) {
            case 'Traductor': return 'translate';
            case 'Redrawer': return 'brush';
            case 'Typer': return 'font_download';
            default: return 'work';
        }
    };

    const getRoleClasses = (role: string) => {
        switch (role) {
            case 'Traductor':
                return 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30';
            case 'Typer':
                return 'text-violet-300 bg-violet-500/10 border-violet-500/30';
            case 'Redrawer':
                return 'text-orange-300 bg-orange-500/10 border-orange-500/30';
            default:
                return 'text-gray-300 bg-gray-500/10 border-gray-500/30';
        }
    };

    if (isLeaderOnly) {
        return null;
    }

    return (
        <div className="flex-1 flex flex-col h-full bg-background-dark overflow-hidden">
            <header className="h-20 bg-surface-dark border-b border-gray-800 hidden md:flex items-center justify-between px-6 lg:px-8 z-10 sticky top-0 shrink-0">
                <h1 className="font-display font-bold text-2xl lg:text-3xl uppercase tracking-wider text-white">
                    <span className="text-primary">Mis Tareas</span>
                </h1>
            </header>

            <div className="flex-1 overflow-y-auto p-4 lg:p-8 pb-32 md:pb-8">
                <div className="max-w-6xl mx-auto space-y-6">
                    <div className="bg-surface-dark p-4 rounded-xl border border-gray-800">
                        <p className="text-xs font-bold text-muted-dark uppercase tracking-wider mb-3">Autoasignacion</p>
                        {hasActiveSelfAssignment && activeSelfAssignment && (
                            <div className="mb-4 flex justify-center">
                                <div className="w-full max-w-2xl text-center p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 shadow-[0_0_28px_rgba(234,179,8,0.2)] animate-pulse">
                                    <div className="inline-flex items-center gap-2 mb-2">
                                        <span className="relative flex h-2.5 w-2.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-300"></span>
                                        </span>
                                        <p className="text-xs text-yellow-300 font-bold uppercase tracking-wider">Asignacion activa detectada</p>
                                    </div>
                                    <p className="text-sm text-yellow-100">
                                    {activeSelfAssignment.proyecto_titulo || activeSelfAssignment.descripcion}
                                    {activeSelfAssignment.capitulo ? ` - Capitulo ${activeSelfAssignment.capitulo}` : ''}
                                    {` (${activeSelfAssignment.rol})`}
                                    </p>
                                    <div className="mt-3 flex items-center justify-center gap-2">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border text-yellow-200 border-yellow-500/40 bg-yellow-500/10">
                                            {activeSelfAssignment.estado}
                                        </span>
                                        <button
                                            onClick={() => router.push(`/asignaciones/${activeSelfAssignment.id}?staff=1`)}
                                            className="px-3 py-1.5 rounded text-xs font-bold bg-background-dark border border-gray-700 text-white hover:border-primary/60"
                                        >
                                            Ver detalle
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className={`grid grid-cols-1 gap-3 relative ${hasActiveSelfAssignment ? 'opacity-60' : ''}`}>
                            {hasActiveSelfAssignment && (
                                <div className="absolute inset-0 z-10 cursor-not-allowed" />
                            )}
                            <div className="grid grid-cols-2 gap-2 bg-background-dark border border-gray-700 rounded-xl p-1">
                                <button
                                    onClick={() => setAssignMode('normal')}
                                    className={`rounded-lg py-2.5 font-bold text-sm transition-colors ${assignMode === 'normal'
                                        ? 'bg-primary text-white'
                                        : 'bg-transparent text-muted-dark hover:text-white'
                                        }`}
                                >
                                    Normal
                                </button>
                                <button
                                    onClick={() => setAssignMode('ruleta')}
                                    className={`rounded-lg py-2.5 font-bold text-sm transition-colors ${assignMode === 'ruleta'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-transparent text-muted-dark hover:text-white'
                                        }`}
                                >
                                    Ruleta
                                </button>
                            </div>

                            <select
                                value={selfForm.rol}
                                onChange={(e) => setSelfForm((prev) => ({ ...prev, rol: e.target.value, capitulo: '' }))}
                                className={`bg-background-dark border rounded-lg px-3 py-2 text-white disabled:opacity-60 ${selfForm.rol ? getRoleClasses(selfForm.rol) : 'border-gray-700'}`}
                                disabled={roleOptions.length === 1}
                            >
                                <option value="">Rol...</option>
                                {roleOptions.map((r) => (
                                    <option key={r} value={r}>{r}</option>
                                ))}
                            </select>
                            <div className="flex gap-2 flex-wrap">
                                {ROLE_OPTIONS.map((roleName) => (
                                    <span key={roleName} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${getRoleClasses(roleName)}`}>
                                        <span className="material-icons-round text-[12px]">{getRoleIcon(roleName)}</span>
                                        {roleName}
                                    </span>
                                ))}
                            </div>
                            {selfForm.rol === 'Traductor' && (
                                <select
                                    value={selfForm.traductor_tipo}
                                    onChange={(e) => setSelfForm((prev) => ({ ...prev, traductor_tipo: e.target.value, capitulo: '' }))}
                                    className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white"
                                >
                                    <option value="ENG" disabled={!selfHasTradEng}>
                                        Traductor ENG
                                    </option>
                                    <option value="CORE" disabled={!canUseCoreTranslatorForSelf}>
                                        {`Traductor ${coreTranslatorLabel}`}
                                    </option>
                                </select>
                            )}

                            {assignMode === 'normal' && (
                                <>
                                    <select
                                        value={selfForm.proyecto_id}
                                        onChange={(e) => setSelfForm((prev) => ({ ...prev, proyecto_id: e.target.value }))}
                                        className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white"
                                    >
                                        <option value="">Proyecto...</option>
                                        {proyectos.map((p) => (
                                            <option key={p.id} value={p.id}>{p.titulo}</option>
                                        ))}
                                    </select>

                                    <select
                                        value={selfForm.capitulo}
                                        onChange={(e) => setSelfForm((prev) => ({ ...prev, capitulo: e.target.value }))}
                                        className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white disabled:opacity-60"
                                        disabled={!selfForm.proyecto_id || !selfForm.rol || capitulos.length === 0}
                                    >
                                        <option value="">{selfForm.proyecto_id && selfForm.rol ? 'Sin capitulo disponible' : 'Capitulo...'}</option>
                                        {capitulos.map((c) => (
                                            <option key={c.numero} value={c.numero}>Siguiente: Capitulo {c.numero}</option>
                                        ))}
                                    </select>
                                </>
                            )}

                            <button
                                onClick={assignMode === 'normal' ? handleSelfAssignNormal : handleSelfAssignRoulette}
                                disabled={assigning || hasActiveSelfAssignment || (assignMode === 'normal'
                                    ? (!selfForm.proyecto_id || !selfForm.rol || !selfForm.capitulo)
                                    : !selfForm.rol)}
                                className={`rounded-lg py-2.5 font-bold text-sm text-white disabled:opacity-50 ${assignMode === 'normal'
                                    ? 'bg-primary hover:bg-primary-dark'
                                    : 'bg-blue-600 hover:bg-blue-700'
                                    }`}
                            >
                                {assignMode === 'normal' ? 'ASIGNAR' : 'LANZAR RULETA'}
                            </button>
                        </div>
                        {hasActiveSelfAssignment && (
                            <p className="text-[11px] text-yellow-400 mt-2">
                                Ya tienes una asignacion activa. Debes completarla antes de tomar otra.
                            </p>
                        )}
                        <p className="text-[11px] text-muted-dark mt-2">
                            <span className="text-primary font-semibold">Normal:</span> asigna el siguiente capitulo disponible.
                        </p>
                        <p className="text-[11px] text-muted-dark">
                            <span className="text-blue-400 font-semibold">Ruleta:</span> sortea el proyecto y asigna el siguiente capitulo disponible de ese proyecto.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="group bg-gradient-to-br from-surface-dark to-surface-darker p-5 rounded-xl border border-gray-800 hover:border-primary/50 shadow-card hover:shadow-card-hover transition-all duration-300 relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            <div className="relative z-10">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[10px] font-bold text-muted-dark uppercase tracking-widest">Total Mes</p>
                                    <div className="bg-primary/20 p-2 rounded-lg shadow-glow shadow-primary/20 group-hover:scale-110 transition-transform">
                                        <span className="material-icons-round text-lg text-primary">assignment</span>
                                    </div>
                                </div>
                                <h3 className="text-3xl font-display font-bold text-white group-hover:text-primary transition-colors">{periodStats?.total_asignaciones ?? asignaciones.length}</h3>
                                {periodStats?.range?.start && periodStats?.range?.end && (
                                    <p className="text-[10px] text-muted-dark mt-1">{periodStats.range.start} - {periodStats.range.end}</p>
                                )}
                                <div className="h-1 w-10 bg-gradient-to-r from-primary to-transparent rounded-full mt-2 group-hover:w-16 transition-all"></div>
                            </div>
                        </div>

                        <div className="group bg-gradient-to-br from-surface-dark to-surface-darker p-5 rounded-xl border border-gray-800 hover:border-yellow-500/50 shadow-card hover:shadow-card-hover transition-all duration-300 relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            <div className="relative z-10">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[10px] font-bold text-muted-dark uppercase tracking-widest">Pendientes</p>
                                    <div className="bg-yellow-500/20 p-2 rounded-lg shadow-glow shadow-yellow-500/20 group-hover:scale-110 transition-transform">
                                        <span className="material-icons-round text-lg text-yellow-500">pending</span>
                                    </div>
                                </div>
                                <h3 className="text-3xl font-display font-bold text-white group-hover:text-yellow-500 transition-colors">{periodStats?.pendientes ?? asignaciones.filter(a => a.estado === 'Pendiente').length}</h3>
                                <div className="h-1 w-10 bg-gradient-to-r from-yellow-500 to-transparent rounded-full mt-2 group-hover:w-16 transition-all"></div>
                            </div>
                        </div>

                        <div className="group bg-gradient-to-br from-surface-dark to-surface-darker p-5 rounded-xl border border-gray-800 hover:border-blue-500/50 shadow-card hover:shadow-card-hover transition-all duration-300 relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            <div className="relative z-10">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[10px] font-bold text-muted-dark uppercase tracking-widest">En Proceso</p>
                                    <div className="bg-blue-500/20 p-2 rounded-lg shadow-glow shadow-blue-500/20 group-hover:scale-110 transition-transform">
                                        <span className="material-icons-round text-lg text-blue-500">sync</span>
                                    </div>
                                </div>
                                <h3 className="text-3xl font-display font-bold text-white group-hover:text-blue-500 transition-colors">{periodStats?.en_proceso ?? asignaciones.filter(a => a.estado === 'En Proceso').length}</h3>
                                <div className="h-1 w-10 bg-gradient-to-r from-blue-500 to-transparent rounded-full mt-2 group-hover:w-16 transition-all"></div>
                            </div>
                        </div>

                        <div className="group bg-gradient-to-br from-surface-dark to-surface-darker p-5 rounded-xl border border-gray-800 hover:border-emerald-500/50 shadow-card hover:shadow-card-hover transition-all duration-300 relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            <div className="relative z-10">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[10px] font-bold text-muted-dark uppercase tracking-widest">Completadas Mes</p>
                                    <div className="bg-emerald-500/20 p-2 rounded-lg shadow-glow shadow-emerald-500/20 group-hover:scale-110 transition-transform">
                                        <span className="material-icons-round text-lg text-emerald-500">check_circle</span>
                                    </div>
                                </div>
                                <h3 className="text-3xl font-display font-bold text-white group-hover:text-emerald-500 transition-colors">{periodStats?.completadas ?? asignaciones.filter(a => a.estado === 'Completado').length}</h3>
                                <div className="h-1 w-10 bg-gradient-to-r from-emerald-500 to-transparent rounded-full mt-2 group-hover:w-16 transition-all"></div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-surface-dark p-4 rounded-xl border border-gray-800 flex flex-wrap gap-4 items-center">
                        <span className="text-muted-dark text-xs font-bold uppercase tracking-wider">Filtros:</span>
                        <select
                            value={filterStatus}
                            onChange={e => setFilterStatus(e.target.value)}
                            className="bg-background-dark text-text-light text-sm rounded-lg border border-gray-700 px-3 py-2 focus:outline-none focus:border-primary"
                        >
                            <option value="todos">Todos los Estados</option>
                            <option value="Pendiente">Pendientes</option>
                            <option value="En Proceso">En Proceso</option>
                            <option value="Completado">Completados</option>
                        </select>
                    </div>

                    <div className="space-y-4">
                        {loading ? (
                            [...Array(3)].map((_, i) => (
                                <div key={i} className="bg-surface-dark rounded-xl p-6 shadow-lg border border-gray-800 animate-pulse h-32"></div>
                            ))
                        ) : filtered.length > 0 ? (
                            filtered.map(asig => (
                                <div
                                    key={asig.id}
                                    onClick={() => router.push(`/asignaciones/${asig.id}?staff=1`)}
                                    className="bg-surface-dark rounded-xl shadow-lg border border-gray-800 overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                                >
                                    <div className="flex relative overflow-hidden">
                                        <div className={`w-1.5 flex-shrink-0 ${asig.estado === 'Completado' ? 'bg-emerald-500' :
                                            asig.estado === 'En Proceso' ? 'bg-blue-500' : 'bg-yellow-500'
                                            }`}></div>
                                        <div className="p-4 w-full flex gap-3 items-start">
                                            <div className="shrink-0 w-16 h-24 sm:w-20 sm:h-28 rounded-lg bg-gray-800 overflow-hidden shadow-md">
                                                {asig.proyecto_imagen ? (
                                                    <img
                                                        src={asig.proyecto_imagen}
                                                        alt={asig.proyecto_titulo || 'Portada'}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center bg-surface-darker text-gray-400">
                                                        <span className="material-icons-round text-2xl">{getRoleIcon(asig.rol)}</span>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <h3 className="font-bold text-lg text-white leading-tight break-words">
                                                    {asig.proyecto_titulo || asig.descripcion}
                                                </h3>
                                                <p className="text-sm text-primary mt-1">{asig.capitulo ? `Capitulo ${asig.capitulo}` : '-'}</p>
                                                <div className="flex gap-2 mt-1 flex-wrap">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${getRoleClasses(asig.rol)}`}>
                                                        <span className="material-icons-round text-[12px]">{getRoleIcon(asig.rol)}</span>
                                                        {asig.rol}
                                                    </span>
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border text-gray-300 border-gray-700 bg-background-dark">
                                                        {asig.estado}
                                                    </span>
                                                </div>

                                                <div className="flex gap-2 mt-3">
                                                    {asig.estado === 'Pendiente' && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleStatusUpdate(asig.id, 'En Proceso');
                                                            }}
                                                            disabled={processingId === asig.id}
                                                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold"
                                                        >
                                                            Iniciar
                                                        </button>
                                                    )}
                                                    {asig.estado === 'En Proceso' && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleStatusUpdate(asig.id, 'Completado');
                                                            }}
                                                            disabled={processingId === asig.id}
                                                            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold"
                                                        >
                                                            Terminar
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            router.push(`/asignaciones/${asig.id}?staff=1`);
                                                        }}
                                                        className="px-4 py-2 bg-background-dark border border-gray-700 text-white rounded-lg text-sm font-bold"
                                                    >
                                                        Ver detalle
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="bg-surface-dark rounded-xl border border-gray-800 border-dashed p-12 text-center">
                                <h3 className="text-xl font-bold text-white mb-2">No tienes asignaciones</h3>
                                <p className="text-muted-dark">Todo esta al dia.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <Link href="/ranking">
                <button className="md:hidden fixed bottom-32 left-6 w-14 h-14 bg-amber-500 text-black rounded-full shadow-[0_4px_20px_rgba(245,158,11,0.35)] flex items-center justify-center z-50 hover:bg-amber-400 transition-transform active:scale-95">
                    <span className="material-icons-round text-3xl">emoji_events</span>
                </button>
            </Link>
        </div>
    );
}
