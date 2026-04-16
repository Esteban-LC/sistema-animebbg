'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUser } from '@/context/UserContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ConfirmModal } from '@/components/ConfirmModal';

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
    drive_url?: string | null;
    review_status?: 'Pendiente' | 'Aprobado' | 'Rechazado' | null;
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
    next_capitulo?: number | null;
    available_count?: number;
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

interface RouletteAssignmentResult {
    id: number;
    proyecto_titulo?: string;
    capitulo?: number;
    rol?: string;
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

function normalizeUrlValue(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function getDisplayStatus(asignacion: Asignacion) {
    return asignacion.review_status === 'Pendiente' ? 'En Revision' : asignacion.estado;
}

function shortenWheelLabel(value: string, max = 18) {
    const text = String(value || '').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
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
    const [completionTarget, setCompletionTarget] = useState<Asignacion | null>(null);
    const [deliveryFile, setDeliveryFile] = useState<File | null>(null);
    const [deliveryUploading, setDeliveryUploading] = useState(false);

    const [selfForm, setSelfForm] = useState({
        proyecto_id: '',
        rol: '',
        traductor_tipo: 'ENG',
        capitulo: '',
    });
    const [assigning, setAssigning] = useState(false);
    const [assignMode, setAssignMode] = useState<AssignMode>('normal');
    const [rouletteSpinning, setRouletteSpinning] = useState(false);
    const [rouletteRotation, setRouletteRotation] = useState(0);
    const [rouletteResult, setRouletteResult] = useState<RouletteAssignmentResult | null>(null);
    const [showAllStaffProjects, setShowAllStaffProjects] = useState(false);
    const [availableProjectsLoading, setAvailableProjectsLoading] = useState(false);

    // Solicitud de asignación para rango Nuevo
    const [solicitudRol, setSolicitudRol] = useState('');
    const [solicitudEnviada, setSolicitudEnviada] = useState(false);
    const [solicitudPendiente, setSolicitudPendiente] = useState(false);
    const [solicitudBloqueadaPorAsignacionActiva, setSolicitudBloqueadaPorAsignacionActiva] = useState(false);
    const [solicitudLoading, setSolicitudLoading] = useState(false);

    const isNuevo = !user?.isAdmin && !(user?.roles || []).includes('Lider de Grupo') && (user?.rango ?? 1) < 2;

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
    const isLeaderRole =
        Boolean(selfRoles.includes('Lider de Grupo') || user?.role === 'Lider de Grupo');
    const canUseStaffTasks = roleOptions.length > 0;
    const isLeaderOnly = isLeaderRole && !canUseStaffTasks;
    const rouletteProjects = useMemo(() => {
        const fallback = ['Proyecto 1', 'Proyecto 2', 'Proyecto 3', 'Proyecto 4', 'Proyecto 5', 'Proyecto 6'];
        const labels = proyectos.slice(0, 8).map((project) => shortenWheelLabel(project.titulo));
        return labels.length > 0 ? labels : fallback;
    }, [proyectos]);
    const visibleStaffProjects = showAllStaffProjects ? proyectos : proyectos.slice(0, 6);
    const translatorSubroleOptions = useMemo(() => {
        const options: Array<{ value: 'ENG' | 'CORE'; label: string }> = [];
        if (selfHasTradEng) {
            options.push({ value: 'ENG', label: 'Traductor ENG' });
        }
        const canUseCoreOption = assignMode === 'ruleta' || !selectedProject
            ? selfHasTradCore
            : canUseCoreTranslatorForSelf;
        if (canUseCoreOption) {
            options.push({ value: 'CORE', label: `Traductor ${coreTranslatorLabel}` });
        }
        return options;
    }, [assignMode, selfHasTradEng, selfHasTradCore, canUseCoreTranslatorForSelf, coreTranslatorLabel]);
    const resolvedTranslatorType =
        translatorSubroleOptions.find((option) => option.value === selfForm.traductor_tipo)?.value
        || translatorSubroleOptions[0]?.value
        || selfForm.traductor_tipo;
    const shouldShowTranslatorSubtypeSelect =
        selfForm.rol === 'Traductor' && translatorSubroleOptions.length > 1;

    const fetchSolicitudStatus = async () => {
        try {
            const res = await fetch('/api/solicitudes-asignacion', { method: 'GET' });
            const data = await res.json();
            setSolicitudPendiente(Boolean(data?.pendiente));
            setSolicitudBloqueadaPorAsignacionActiva(Boolean(data?.active_assignment));
        } catch {
            // silent
        }
    };

    const fetchNextChapterOption = async (proyectoId: string, rol: string) => {
        if (!proyectoId || !rol) {
            setCapitulos([]);
            setSelfForm((prev) => ({ ...prev, capitulo: '' }));
            return;
        }

        try {
            const query = new URLSearchParams({ rol, mode: 'next' });
            if (rol === 'Traductor') query.set('traductor_tipo', resolvedTranslatorType || 'CORE');
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
        const tasks: Promise<unknown>[] = [
            fetchAsignaciones(),
            fetchPeriodStats(),
        ];
        if (isNuevo) {
            tasks.push(
                fetchSolicitudStatus()
            );
        }
        Promise.all(tasks).finally(() => setLoading(false));
    }, [user, isNuevo]);

    useEffect(() => {
        if (!user) return;
        const id = window.setInterval(() => {
            fetchAsignaciones();
            fetchPeriodStats();
            if (isNuevo) fetchSolicitudStatus();
        }, 8000);
        const onRealtimeUpdate = () => {
            fetchAsignaciones();
            fetchPeriodStats();
            if (isNuevo) fetchSolicitudStatus();
        };
        window.addEventListener('realtime:update', onRealtimeUpdate);
        return () => {
            window.clearInterval(id);
            window.removeEventListener('realtime:update', onRealtimeUpdate);
        };
    }, [user?.id, isNuevo]);

    useEffect(() => {
        if (isLeaderOnly) return;

        setSelfForm((prev) => {
            const next = { ...prev };
            let changed = false;

            const singleTranslatorSubtype = translatorSubroleOptions.length === 1 ? translatorSubroleOptions[0].value : null;
            if (singleTranslatorSubtype && prev.traductor_tipo !== singleTranslatorSubtype) {
                next.traductor_tipo = singleTranslatorSubtype;
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
    }, [roleOptionsKey, translatorSubroleOptions]);

    useEffect(() => {
        if (isLeaderOnly) return;
        if (selfForm.rol !== 'Traductor') return;

        const currentType = selfForm.traductor_tipo;
        const canUseEng = translatorSubroleOptions.some((option) => option.value === 'ENG');
        const canUseCore = translatorSubroleOptions.some((option) => option.value === 'CORE');

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
    }, [selfForm.rol, selfForm.traductor_tipo, translatorSubroleOptions]);

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

    useEffect(() => {
        if (!user || isNuevo || isLeaderOnly) return;

        if (!selfForm.rol) {
            setProyectos([]);
            setShowAllStaffProjects(false);
            setAvailableProjectsLoading(false);
            setSelfForm((prev) => (
                prev.proyecto_id || prev.capitulo
                    ? { ...prev, proyecto_id: '', capitulo: '' }
                    : prev
            ));
            return;
        }

        if (selfForm.rol === 'Traductor' && translatorSubroleOptions.length === 0) {
            setProyectos([]);
            setShowAllStaffProjects(false);
            setAvailableProjectsLoading(false);
            setSelfForm((prev) => (
                prev.proyecto_id || prev.capitulo
                    ? { ...prev, proyecto_id: '', capitulo: '' }
                    : prev
            ));
            return;
        }

        const query = new URLSearchParams({
            usuario_id: String(user.id),
            rol: selfForm.rol,
        });
        if (selfForm.rol === 'Traductor') {
            query.set('traductor_tipo', resolvedTranslatorType || 'ENG');
        }

        let cancelled = false;
        setProyectos([]);
        setShowAllStaffProjects(false);
        setAvailableProjectsLoading(true);

        fetch(`/api/asignaciones/auto?${query.toString()}`)
            .then((res) => res.json())
            .then((data) => {
                if (cancelled) return;
                const list = Array.isArray(data?.projects) ? data.projects : [];
                setProyectos(list);
                setShowAllStaffProjects(false);
                setSelfForm((prev) => {
                    const stillValid = list.some((project: Proyecto) => String(project.id) === String(prev.proyecto_id));
                    if (stillValid) return prev;
                    if (!prev.proyecto_id && !prev.capitulo) return prev;
                    return { ...prev, proyecto_id: '', capitulo: '' };
                });
            })
            .catch(() => {
                if (cancelled) return;
                setProyectos([]);
                setSelfForm((prev) => (
                    prev.proyecto_id || prev.capitulo
                        ? { ...prev, proyecto_id: '', capitulo: '' }
                        : prev
                ));
            })
            .finally(() => {
                if (!cancelled) setAvailableProjectsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [
        user?.id,
        isNuevo,
        isLeaderOnly,
        selfForm.rol,
        resolvedTranslatorType,
        translatorSubroleOptions.length,
    ]);

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
                    traductor_tipo: selfForm.rol === 'Traductor' ? resolvedTranslatorType : null,
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
        setRouletteSpinning(true);
        setRouletteRotation((prev) => prev + 1440 + Math.floor(Math.random() * 360));
        window.setTimeout(() => {
            setRouletteSpinning(false);
        }, 1150);
        try {
            const res = await fetch('/api/asignaciones/auto', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    usuario_id: user.id,
                    rol: selfForm.rol,
                    traductor_tipo: selfForm.rol === 'Traductor' ? resolvedTranslatorType : undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'No se pudo tirar ruleta');

            await fetchAsignaciones();
            setSelfForm((prev) => ({ ...prev, proyecto_id: '', capitulo: '' }));
            setCapitulos([]);
            const proyectoLabel = data?.proyecto_titulo ? `${data.proyecto_titulo} - ` : '';
            setRouletteResult({
                id: Number(data?.id),
                proyecto_titulo: data?.proyecto_titulo,
                capitulo: Number(data?.capitulo),
                rol: data?.rol || selfForm.rol,
            });
            showToast(`Ruleta asigno ${proyectoLabel}capitulo ${data.capitulo}`, 'success');
        } catch (error: unknown) {
            showToast(getErrorMessage(error, 'Error'), 'error');
        } finally {
            setRouletteSpinning(false);
            setAssigning(false);
        }
    };

    const handleSolicitudAsignacion = async () => {
        if (!solicitudRol) return;
        setSolicitudLoading(true);
        try {
            const res = await fetch('/api/solicitudes-asignacion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rol: solicitudRol }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'No se pudo enviar la solicitud');
            setSolicitudEnviada(true);
            setSolicitudPendiente(true);
            setSolicitudBloqueadaPorAsignacionActiva(false);
            showToast('Solicitud enviada. Un admin/lider te asignara pronto.', 'success');
        } catch (error: unknown) {
            showToast(getErrorMessage(error, 'Error'), 'error');
        } finally {
            setSolicitudLoading(false);
        }
    };

    const filtered = asignaciones.filter(a => {
        if (filterStatus !== 'todos' && getDisplayStatus(a) !== filterStatus) return false;
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

    const openCompletionFlow = (asignacion: Asignacion) => {
        setCompletionTarget(asignacion);
        setDeliveryFile(null);
    };

    const closeCompletionFlow = () => {
        if (deliveryUploading) return;
        setCompletionTarget(null);
        setDeliveryFile(null);
    };

    const getFileAcceptForRole = (role: string) => {
        const r = String(role || '').toLowerCase();
        if (r === 'redrawer' || r === 'typer') return '.zip';
        if (r === 'traductor' || r.startsWith('traductor')) return '.docx,.doc,.pdf';
        return '.zip,.docx,.doc,.pdf';
    };

    const getFileDescForRole = (role: string) => {
        const r = String(role || '').toLowerCase();
        if (r === 'redrawer') return 'Seleccionar archivo .zip (paginas limpias)';
        if (r === 'typer') return 'Seleccionar archivo .zip (paginas typeadas)';
        if (r === 'traductor' || r.startsWith('traductor')) return 'Seleccionar archivo (.docx, .doc, .pdf)';
        return 'Seleccionar archivo';
    };

    const submitCompletionFlow = async () => {
        if (!completionTarget || !deliveryFile || deliveryUploading) return;
        setDeliveryUploading(true);
        try {
            const form = new FormData();
            form.append('assignment_id', String(completionTarget.id));
            form.append('zip_file', deliveryFile);
            const res = await fetch('/api/drive/upload-redraw', { method: 'POST', body: form });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(data?.error || 'Error al subir el archivo', 'error');
                return;
            }
            await fetchAsignaciones();
            await fetchPeriodStats();
            closeCompletionFlow();
            showToast('Entrega enviada a revision correctamente', 'success');
        } catch (error: unknown) {
            showToast(getErrorMessage(error, 'Error al subir el archivo'), 'error');
        } finally {
            setDeliveryUploading(false);
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
                        <p className="text-xs font-bold text-muted-dark uppercase tracking-wider mb-3">
                            {isNuevo ? 'Solicitar Asignacion' : 'Autoasignacion'}
                        </p>

                        {/* ── RANGO NUEVO: formulario de solicitud ── */}
                        {isNuevo ? (
                            <div className="space-y-3">
                                {hasActiveSelfAssignment || solicitudBloqueadaPorAsignacionActiva ? (
                                    <div className="p-4 rounded-xl border border-yellow-500/40 bg-yellow-500/10 text-center">
                                        <span className="material-icons-round text-yellow-400 text-2xl mb-1 block">assignment_late</span>
                                        <p className="text-sm text-yellow-200 font-semibold">Ya tienes una asignacion activa</p>
                                        <p className="text-xs text-yellow-300/70 mt-1">
                                            Debes completar o liberar tu tarea actual antes de solicitar otra.
                                        </p>
                                    </div>
                                ) : solicitudPendiente || solicitudEnviada ? (
                                    <div className="p-4 rounded-xl border border-yellow-500/40 bg-yellow-500/10 text-center">
                                        <span className="material-icons-round text-yellow-400 text-2xl mb-1 block">hourglass_top</span>
                                        <p className="text-sm text-yellow-200 font-semibold">Solicitud enviada</p>
                                        <p className="text-xs text-yellow-300/70 mt-1">Un admin o lider de grupo te asignara en breve.</p>
                                    </div>
                                ) : (
                                    <>
                                        <div className="space-y-2">
                                            <p className="text-[10px] font-bold text-muted-dark uppercase tracking-widest text-center">
                                                Rol solicitado
                                            </p>
                                            <div className="flex flex-wrap justify-center gap-3">
                                                {roleOptions.map((roleName) => {
                                                    const isSelected = solicitudRol === roleName;
                                                    return (
                                                        <button
                                                            key={roleName}
                                                            type="button"
                                                            onClick={() => setSolicitudRol(roleName)}
                                                            className={`w-full sm:w-[200px] rounded-2xl border px-4 py-5 text-center transition-all ${
                                                                isSelected
                                                                    ? `${getRoleClasses(roleName)} shadow-lg scale-[1.01]`
                                                                    : 'border-gray-700 bg-background-dark text-gray-300 hover:border-gray-500'
                                                            }`}
                                                        >
                                                            <div className="flex flex-col items-center gap-2">
                                                                <span className={`material-icons-round text-2xl ${isSelected ? '' : 'text-gray-400'}`}>
                                                                    {getRoleIcon(roleName)}
                                                                </span>
                                                                <span className="text-[10px] font-bold uppercase tracking-[0.35em] text-muted-dark">
                                                                    Rol
                                                                </span>
                                                                <span className="font-display text-lg text-white">
                                                                    {roleName}
                                                                </span>
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <button
                                            onClick={handleSolicitudAsignacion}
                                            disabled={!solicitudRol || solicitudLoading}
                                            className="w-full rounded-lg py-2.5 font-bold text-sm text-white bg-primary hover:bg-primary-dark disabled:opacity-50 transition-colors"
                                        >
                                            {solicitudLoading ? 'Enviando...' : 'SOLICITAR ASIGNACION'}
                                        </button>
                                        <p className="text-[11px] text-muted-dark">
                                            Tu solicitud llegara al admin o lider de tu grupo para que te asignen un capitulo.
                                        </p>
                                    </>
                                )}
                            </div>
                        ) : (
                        <>
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

                            <div className="space-y-2">
                                <p className="text-[10px] font-bold text-muted-dark uppercase tracking-widest text-center">
                                    Rol / Tarea
                                </p>
                                <div className="flex flex-wrap justify-center gap-3">
                                    {roleOptions.map((roleName) => {
                                        const isSelected = selfForm.rol === roleName;
                                        return (
                                            <button
                                                key={roleName}
                                                type="button"
                                                onClick={() => setSelfForm((prev) => ({ ...prev, rol: roleName, capitulo: '' }))}
                                                className={`w-full sm:w-[200px] rounded-2xl border px-4 py-5 text-center transition-all ${
                                                    isSelected
                                                        ? `${getRoleClasses(roleName)} shadow-lg scale-[1.01]`
                                                        : 'border-gray-700 bg-background-dark text-gray-300 hover:border-gray-500'
                                                }`}
                                            >
                                                <div className="flex flex-col items-center gap-2">
                                                    <span className={`material-icons-round text-2xl ${isSelected ? '' : 'text-gray-400'}`}>
                                                        {getRoleIcon(roleName)}
                                                    </span>
                                                    <span className="text-[10px] font-bold uppercase tracking-[0.35em] text-muted-dark">
                                                        Rol
                                                    </span>
                                                    <span className="font-display text-lg text-white">
                                                        {roleName}
                                                    </span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            {shouldShowTranslatorSubtypeSelect && (
                                <select
                                    value={selfForm.traductor_tipo}
                                    onChange={(e) => setSelfForm((prev) => ({ ...prev, traductor_tipo: e.target.value, capitulo: '' }))}
                                    className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white"
                                >
                                    {translatorSubroleOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            )}
                            {selfForm.rol === 'Traductor' && !!selectedProject && translatorSubroleOptions.length === 0 && (
                                <p className="text-[11px] text-red-300">
                                    No tienes un subrol traductor compatible con este proyecto.
                                </p>
                            )}

                            {assignMode === 'normal' && (
                                <>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-[10px] font-bold text-muted-dark uppercase tracking-widest text-center flex-1">
                                                Proyecto
                                            </p>
                                            {proyectos.length > 6 && !availableProjectsLoading && (
                                                <button
                                                    type="button"
                                                    onClick={() => setShowAllStaffProjects((prev) => !prev)}
                                                    className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-700 bg-background-dark text-[10px] font-bold uppercase tracking-wider text-gray-300 hover:border-primary/40 hover:text-white transition-colors"
                                                >
                                                    {showAllStaffProjects ? 'Mostrar menos' : `Mostrar mas (${proyectos.length})`}
                                                </button>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-muted-dark text-center">
                                            Solo se muestran obras de tu grupo con capitulos disponibles para este rol.
                                        </p>
                                        {availableProjectsLoading && (
                                            <div className="rounded-xl border border-gray-700 bg-background-dark px-4 py-6 text-sm text-muted-dark text-center">
                                                Buscando obras disponibles...
                                            </div>
                                        )}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {!availableProjectsLoading && visibleStaffProjects.map((project) => {
                                                const selected = String(project.id) === selfForm.proyecto_id;
                                                return (
                                                    <button
                                                        key={project.id}
                                                        type="button"
                                                        onClick={() => setSelfForm((prev) => ({ ...prev, proyecto_id: String(project.id), capitulo: '' }))}
                                                        className={`rounded-xl border p-3 text-left transition-all ${
                                                            selected
                                                                ? 'border-primary bg-primary/10 shadow-[0_0_20px_rgba(255,46,77,0.18)]'
                                                                : 'border-gray-700 bg-background-dark hover:border-primary/50 hover:bg-surface-darker'
                                                        }`}
                                                    >
                                                        <div className="flex gap-3 items-start">
                                                            <div className="w-14 h-18 shrink-0 rounded-lg overflow-hidden border border-gray-700 bg-surface-darker">
                                                                {project.imagen_url ? (
                                                                    <img src={project.imagen_url} alt={project.titulo} className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <div className="w-full h-full flex items-center justify-center text-gray-500">
                                                                        <span className="material-icons-round">auto_stories</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-start justify-between gap-2">
                                                                    <p className="font-semibold leading-tight line-clamp-3 text-white">
                                                                        {project.titulo}
                                                                    </p>
                                                                    {selected && (
                                                                        <span className="material-icons-round text-primary text-lg shrink-0">check_circle</span>
                                                                    )}
                                                                </div>
                                                                <div className="flex flex-wrap gap-2 mt-3">
                                                                    <span className="px-2 py-1 rounded-md bg-surface-dark border border-gray-700 text-[10px] uppercase tracking-wider text-gray-300 font-bold">
                                                                        {project.tipo || 'Proyecto'}
                                                                    </span>
                                                                    <span className={`px-2 py-1 rounded-md text-[10px] uppercase tracking-wider font-bold ${
                                                                        normalizeStatus(project.estado) === 'activo'
                                                                            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                                                                            : 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-300'
                                                                    }`}>
                                                                        {project.estado || 'Activo'}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        {!availableProjectsLoading && selfForm.rol && proyectos.length === 0 && (
                                            <div className="rounded-xl border border-dashed border-gray-700 bg-background-dark px-4 py-6 text-sm text-muted-dark text-center">
                                                No hay obras con capitulos disponibles para este rol.
                                            </div>
                                        )}
                                        {!availableProjectsLoading && !showAllStaffProjects && proyectos.length > visibleStaffProjects.length && (
                                            <p className="text-xs text-muted-dark text-center">
                                                Mostrando {visibleStaffProjects.length} de {proyectos.length} proyectos.
                                            </p>
                                        )}
                                    </div>

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

                            {assignMode === 'ruleta' && (
                                <div className="py-4">
                                    <div className="flex justify-center">
                                        <div className="relative w-full max-w-[360px] aspect-square">
                                            <div className="absolute left-[-10px] top-1/2 -translate-y-1/2 z-20 text-blue-400 drop-shadow-[0_0_10px_rgba(59,130,246,0.45)]">
                                                <span className="material-icons-round text-5xl">arrow_right_alt</span>
                                            </div>
                                            <div
                                                className="relative w-full h-full rounded-full border-[10px] border-surface-darker shadow-[0_0_0_2px_rgba(255,255,255,0.04),0_20px_60px_rgba(0,0,0,0.35)] overflow-hidden"
                                                style={{
                                                    background: `conic-gradient(
                                                        from -90deg,
                                                        #0f172a 0deg 45deg,
                                                        #3b0764 45deg 90deg,
                                                        #052e16 90deg 135deg,
                                                        #3f1d02 135deg 180deg,
                                                        #3f0b1d 180deg 225deg,
                                                        #082f49 225deg 270deg,
                                                        #172554 270deg 315deg,
                                                        #3f3f06 315deg 360deg
                                                    )`,
                                                    transform: `rotate(${rouletteRotation}deg)`,
                                                    transition: rouletteSpinning
                                                        ? 'transform 1100ms cubic-bezier(0.12, 0.82, 0.18, 1)'
                                                        : 'transform 220ms ease-out',
                                                }}
                                            >
                                                {rouletteProjects.map((label, index) => {
                                                    const angle = (360 / rouletteProjects.length) * index;
                                                    return (
                                                        <div
                                                            key={`${label}-${index}`}
                                                            className="absolute left-1/2 top-1/2 w-[42%] origin-left"
                                                            style={{ transform: `translateY(-50%) rotate(${angle}deg)` }}
                                                        >
                                                            <div className="pl-5 pr-2">
                                                                <span
                                                                    className="block text-[11px] sm:text-xs font-bold text-white/85 leading-tight"
                                                                    style={{ transform: 'rotate(90deg)', transformOrigin: 'left center' }}
                                                                >
                                                                    {label}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}

                                                <div className="absolute inset-[22%] rounded-full bg-surface-dark/95 border border-white/10 shadow-[0_0_0_6px_rgba(0,0,0,0.18)] flex items-center justify-center">
                                                    <button
                                                        onClick={handleSelfAssignRoulette}
                                                        disabled={assigning || rouletteSpinning || hasActiveSelfAssignment || !selfForm.rol || (selfForm.rol === 'Traductor' && translatorSubroleOptions.length === 0)}
                                                        className="w-[58%] aspect-square rounded-2xl bg-gradient-to-b from-sky-400 to-blue-600 text-white shadow-[0_18px_45px_rgba(37,99,235,0.4)] hover:scale-[1.02] transition-all disabled:opacity-50 disabled:hover:scale-100 flex flex-col items-center justify-center"
                                                    >
                                                        <span className="material-icons-round text-6xl sm:text-7xl leading-none">play_arrow</span>
                                                        <span className="font-display text-xl sm:text-2xl uppercase tracking-wider -mt-1">
                                                            {rouletteSpinning ? 'Girando...' : 'Iniciar'}
                                                        </span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    {assigning && (
                                        <p className="mt-4 text-center text-sm text-blue-200">
                                            Buscando un proyecto y capitulo disponible...
                                        </p>
                                    )}
                                </div>
                            )}

                            {assignMode === 'normal' && (
                                <button
                                    onClick={handleSelfAssignNormal}
                                    disabled={assigning || hasActiveSelfAssignment || !selfForm.proyecto_id || !selfForm.rol || !selfForm.capitulo || (selfForm.rol === 'Traductor' && translatorSubroleOptions.length === 0)}
                                    className="rounded-lg py-2.5 font-bold text-sm text-white disabled:opacity-50 bg-primary hover:bg-primary-dark"
                                >
                                    ASIGNAR
                                </button>
                            )}
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
                        </>
                        )}
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
                            <option value="En Revision">En Revision</option>
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
                                (() => {
                                    const displayStatus = getDisplayStatus(asig);
                                    const isPendingReview = displayStatus === 'En Revision';
                                    const accentClass = displayStatus === 'Completado'
                                        ? 'bg-emerald-500'
                                        : displayStatus === 'En Revision'
                                            ? 'bg-violet-500'
                                            : displayStatus === 'En Proceso'
                                                ? 'bg-blue-500'
                                                : 'bg-yellow-500';
                                    const badgeClass = displayStatus === 'Completado'
                                        ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
                                        : displayStatus === 'En Revision'
                                            ? 'text-violet-200 border-violet-500/30 bg-violet-500/10'
                                            : displayStatus === 'En Proceso'
                                                ? 'text-blue-300 border-blue-500/30 bg-blue-500/10'
                                                : 'text-gray-300 border-gray-700 bg-background-dark';
                                    return (
                                <div
                                    key={asig.id}
                                    onClick={() => router.push(`/asignaciones/${asig.id}?staff=1`)}
                                    className="bg-surface-dark rounded-xl shadow-lg border border-gray-800 overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                                >
                                    <div className="flex relative overflow-hidden">
                                        <div className={`w-1.5 flex-shrink-0 ${accentClass}`}></div>
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
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${badgeClass}`}>
                                                        {displayStatus}
                                                    </span>
                                                </div>
                                                {isPendingReview && (
                                                    <p className="mt-2 text-[11px] text-violet-200">
                                                        Tu entrega ya se subio y esta esperando revision de lider/admin.
                                                    </p>
                                                )}

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
                                                    {asig.estado === 'En Proceso' && !isPendingReview && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                            openCompletionFlow(asig);
                                                            }}
                                                            disabled={deliveryUploading}
                                                            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold"
                                                        >
                                                            Enviar a revision
                                                        </button>
                                                    )}
                                                    {isPendingReview && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                router.push(`/asignaciones/${asig.id}?staff=1`);
                                                            }}
                                                            className="px-4 py-2 bg-violet-600/15 border border-violet-500/30 text-violet-200 rounded-lg text-sm font-bold"
                                                        >
                                                            En revision
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
                                    );
                                })()
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

            {rouletteResult && (
                <div className="fixed inset-0 z-[54] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-lg rounded-[28px] border border-blue-500/25 bg-gradient-to-br from-surface-dark via-surface-dark to-[#151c2c] shadow-[0_28px_100px_rgba(0,0,0,0.5)] overflow-hidden">
                        <div className="p-6 border-b border-blue-500/15 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_45%)]">
                            <div className="flex items-start gap-4">
                                <div className="w-14 h-14 rounded-2xl bg-blue-500/15 border border-blue-400/25 flex items-center justify-center shadow-[0_0_25px_rgba(59,130,246,0.18)] shrink-0">
                                    <span className="material-icons-round text-blue-300 text-3xl">casino</span>
                                </div>
                                <div className="flex-1">
                                    <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-blue-300">Ruleta completada</p>
                                    <h3 className="text-3xl font-display font-bold text-white mt-2 leading-tight">Esta es tu asignacion</h3>
                                    <p className="text-sm text-gray-300 mt-3 max-w-md">
                                        La ruleta ya eligio tu capitulo. Entra directo al detalle para revisarlo y marcarlo como en proceso.
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 space-y-5">
                            <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
                                <p className="text-lg text-white font-semibold leading-snug">
                                    {rouletteResult.proyecto_titulo || 'Proyecto asignado'}
                                </p>
                                <div className="flex flex-wrap gap-2 mt-4">
                                    <span className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-400/20 text-blue-200 text-xs font-bold uppercase tracking-wider">
                                        <span className="material-icons-round text-base">bookmark</span>
                                        Cap. {rouletteResult.capitulo || '-'}
                                    </span>
                                    <span className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-400/20 text-violet-200 text-xs font-bold uppercase tracking-wider">
                                        <span className="material-icons-round text-base">task_alt</span>
                                        {rouletteResult.rol || selfForm.rol}
                                    </span>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-gray-800 bg-background-dark/70 px-4 py-3">
                                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-dark">Siguiente paso</p>
                                <p className="text-sm text-gray-200 mt-2">
                                    Abre la asignacion para revisar enlaces, archivos y cambiar el estado a <span className="text-blue-300 font-semibold">En Proceso</span>.
                                </p>
                            </div>
                        </div>
                        <div className="p-6 pt-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button
                                onClick={() => {
                                    router.push(`/asignaciones/${rouletteResult.id}?staff=1`);
                                    setRouletteResult(null);
                                }}
                                className="w-full px-4 py-3.5 rounded-2xl font-bold text-white bg-gradient-to-r from-blue-500 to-blue-700 hover:from-blue-400 hover:to-blue-600 transition-all shadow-[0_12px_30px_rgba(37,99,235,0.35)]"
                            >
                                Ir a asignacion
                            </button>
                            <button
                                onClick={() => setRouletteResult(null)}
                                className="w-full px-4 py-3.5 rounded-2xl font-bold text-white bg-background-dark border border-gray-700 hover:border-blue-400/35 transition-colors"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {completionTarget && (
                <div className="fixed inset-0 z-[55] bg-black/80 flex items-center justify-center p-4">
                    <div className="w-full max-w-lg rounded-2xl border border-gray-800 bg-surface-dark shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-800">
                            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-400">Entrega</p>
                            <h3 className="text-xl font-display font-bold text-white mt-1">Enviar a revision</h3>
                            <p className="text-sm text-gray-300 mt-2">
                                {completionTarget.proyecto_titulo || completionTarget.descripcion}
                                {completionTarget.capitulo ? ` - Capitulo ${completionTarget.capitulo}` : ''}
                                {` (${completionTarget.rol})`}
                            </p>
                        </div>
                        <div className="p-6 space-y-4">
                            <label className="block w-full cursor-pointer rounded-xl border-2 border-dashed border-gray-700 hover:border-emerald-500/50 p-6 text-center transition-colors">
                                <span className="material-icons-round text-3xl text-muted-dark mb-2 block">upload_file</span>
                                <span className="text-sm text-gray-300">
                                    {deliveryFile ? deliveryFile.name : getFileDescForRole(completionTarget.rol)}
                                </span>
                                <input
                                    type="file"
                                    accept={getFileAcceptForRole(completionTarget.rol)}
                                    className="hidden"
                                    onChange={(e) => setDeliveryFile(e.target.files?.[0] || null)}
                                />
                            </label>
                            {deliveryFile && (
                                <p className="text-[11px] text-muted-dark">
                                    Tamaño: {(deliveryFile.size / 1024 / 1024).toFixed(1)} MB
                                </p>
                            )}
                            <p className="text-[11px] text-muted-dark leading-relaxed">
                                Al subir, la entrega quedara en revision hasta que lider o admin la apruebe.
                            </p>
                        </div>
                        <div className="p-6 pt-0 flex gap-3">
                            <button
                                onClick={closeCompletionFlow}
                                disabled={deliveryUploading}
                                className="flex-1 px-4 py-3 rounded-xl font-bold text-gray-300 hover:text-white hover:bg-gray-800 transition-colors disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={submitCompletionFlow}
                                disabled={!deliveryFile || deliveryUploading}
                                className="flex-1 px-4 py-3 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50"
                            >
                                {deliveryUploading ? 'Subiendo...' : 'Subir y enviar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
