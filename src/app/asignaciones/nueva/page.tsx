'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/context/UserContext';

interface Usuario {
    id: number;
    nombre: string;
    grupo_id?: number;
    roles?: string[];
    activo?: number;
}

interface Proyecto {
    id: number;
    titulo: string;
    tipo?: string;
    estado?: string;
    raw_secundario_activo?: number;
    imagen_url?: string;
}

interface Capitulo {
    numero: number;
    status: 'disponible' | 'en_proceso' | 'completado' | 'no_realizado';
    asignado_a?: string;
    fecha_asignacion?: string;
    dias_desde_asignacion?: number;
}

const ROLE_OPTIONS = ['Traductor', 'Redrawer', 'Typer'];
const TRANSLATOR_ENG_ROLE = 'Traductor ENG';
const TRANSLATOR_KO_ROLE = 'Traductor KO';
const TRANSLATOR_JAP_ROLE = 'Traductor JAP';
const TRANSLATOR_CORE_LEGACY_ROLE = 'Traductor KO/JAP';

function getCoreTranslatorLabelByProjectType(tipo: string | undefined) {
    const normalized = String(tipo || '').toLowerCase();
    if (normalized === 'manga') return 'JAP';
    if (normalized === 'manhwa') return 'KO';
    return 'KO/JAP';
}

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

function getStatusLabel(status: Capitulo['status']) {
    if (status === 'disponible') return 'FALTANTE';
    if (status === 'en_proceso') return 'EN PROCESO';
    if (status === 'completado') return 'HECHO';
    return 'BLOQUEADO';
}

function getRoleAwareStatusLabel(status: Capitulo['status'], role: string) {
    const roleKey = String(role || '');
    if (status === 'en_proceso') return 'EN PROCESO';
    if (status === 'no_realizado') {
        if (roleKey === 'Typer') return 'SIN PRERREQUISITO';
        return 'BLOQUEADO';
    }

    if (roleKey === 'Traductor') {
        if (status === 'completado') return 'TRADUCIDO';
        if (status === 'disponible') return 'POR TRADUCIR';
    }
    if (roleKey === 'Redrawer') {
        if (status === 'completado') return 'REDRAW LISTO';
        if (status === 'disponible') return 'POR REDRAW';
    }
    if (roleKey === 'Typer') {
        if (status === 'completado') return 'TYPEADO';
        if (status === 'disponible') return 'POR TYPEAR';
    }

    return getStatusLabel(status);
}

function getSummaryLabels(role: string) {
    if (role === 'Traductor') {
        return { disponible: 'Por traducir', completado: 'Traducidos' };
    }
    if (role === 'Redrawer') {
        return { disponible: 'Por redraw', completado: 'Redraw listos' };
    }
    if (role === 'Typer') {
        return { disponible: 'Por typear', completado: 'Typeados' };
    }
    return { disponible: 'Faltantes', completado: 'Hechos' };
}

function normalizeStatus(value: string | undefined) {
    return String(value || '').trim().toLowerCase();
}

function NuevaAsignacionContent() {
    const { user } = useUser();
    const router = useRouter();
    const searchParams = useSearchParams();
    const preSelectedUser = searchParams.get('usuario_id') || '';

    const roles = user?.roles || [];
    const productionRoles = ['Traductor', 'Traductor ENG', 'Traductor KO', 'Traductor JAP', 'Traductor KO/JAP', 'Redrawer', 'Typer'];
    const hasProductionRole = roles.some((role) => productionRoles.includes(role));
    const isAdmin = roles.includes('Administrador') || user?.role === 'admin';
    const isLeader = (roles.includes('Lider de Grupo') || user?.role === 'Lider de Grupo') && !hasProductionRole;

    const [usuarios, setUsuarios] = useState<Usuario[]>([]);
    const [proyectos, setProyectos] = useState<Proyecto[]>([]);
    const [capitulos, setCapitulos] = useState<Capitulo[]>([]);
    const [mostrarReasignar, setMostrarReasignar] = useState(false);
    const [rolesDisponiblesUsuario, setRolesDisponiblesUsuario] = useState<string[]>([]);

    const [formData, setFormData] = useState({
        proyecto_id: '',
        capitulo: '',
        usuario_id: preSelectedUser,
        rol: '',
        traductor_tipo: 'ENG',
        descripcion: ''
    });
    const [loading, setLoading] = useState(false);
    const [autoLoading, setAutoLoading] = useState(false);
    const [notice, setNotice] = useState<{ type: 'error' | 'info'; message: string } | null>(null);

    const statusSummary = capitulos.reduce(
        (acc, item) => {
            acc.total += 1;
            acc[item.status] += 1;
            return acc;
        },
        { total: 0, disponible: 0, en_proceso: 0, completado: 0, no_realizado: 0 }
    );
    const summaryLabels = getSummaryLabels(formData.rol);
    const selectedProject = proyectos.find((p) => String(p.id) === String(formData.proyecto_id));
    const selectedUser = usuarios.find((u) => String(u.id) === String(formData.usuario_id));
    const selectedUserRoles = Array.isArray(selectedUser?.roles) ? selectedUser.roles : [];
    const selectedUserHasTradCore =
        selectedUserRoles.includes('Traductor')
        || selectedUserRoles.includes(TRANSLATOR_KO_ROLE)
        || selectedUserRoles.includes(TRANSLATOR_JAP_ROLE)
        || selectedUserRoles.includes(TRANSLATOR_CORE_LEGACY_ROLE);
    const selectedUserHasTradEng = selectedUserRoles.includes(TRANSLATOR_ENG_ROLE);
    const coreTranslatorLabel = getCoreTranslatorLabelByProjectType(selectedProject?.tipo);
    const canUseCoreTranslator = Number(selectedProject?.raw_secundario_activo || 0) === 1;
    const canUseCoreTranslatorForSelection = canUseCoreTranslator && selectedUserHasTradCore;

    useEffect(() => {
        fetch('/api/usuarios')
            .then(res => res.json())
            .then(data => {
                const list = Array.isArray(data) ? data : [];
                setUsuarios(list.filter((u) => Number(u?.activo ?? 1) === 1));
            });

        fetch('/api/proyectos')
            .then(res => res.json())
            .then(data => {
                const list = Array.isArray(data) ? data : [];
                const visibles = list.filter((p) => !['pausado', 'cancelado'].includes(normalizeStatus(p?.estado)));
                setProyectos(visibles);
            });
    }, []);

    useEffect(() => {
        if (formData.proyecto_id) {
            const query = new URLSearchParams();
            if (formData.rol) query.set('rol', formData.rol);
            if (formData.rol === 'Traductor') query.set('traductor_tipo', formData.traductor_tipo || 'CORE');
            const suffix = query.toString() ? `?${query.toString()}` : '';
            fetch(`/api/proyectos/${formData.proyecto_id}/capitulos${suffix}`)
                .then(res => res.json())
                .then(data => {
                    if (!Array.isArray(data)) {
                        setCapitulos([]);
                        return;
                    }
                    setCapitulos(data);
                })
                .catch(() => setCapitulos([]));
        } else {
            setCapitulos([]);
        }
    }, [formData.proyecto_id, formData.rol, formData.traductor_tipo, mostrarReasignar]);

    useEffect(() => {
        const userById = usuarios.find((u) => String(u.id) === String(formData.usuario_id));
        if (!userById) {
            setRolesDisponiblesUsuario([]);
            setFormData((prev) => (prev.rol ? { ...prev, rol: '' } : prev));
            return;
        }

        const roles = Array.isArray(userById.roles) ? userById.roles : [];
        const validRoles = resolveAvailableRoles(roles);
        setRolesDisponiblesUsuario(validRoles);

        const hasTradCore =
            roles.includes('Traductor')
            || roles.includes(TRANSLATOR_KO_ROLE)
            || roles.includes(TRANSLATOR_JAP_ROLE)
            || roles.includes(TRANSLATOR_CORE_LEGACY_ROLE);
        const hasTradEng = roles.includes(TRANSLATOR_ENG_ROLE);

        setFormData((prev) => {
            const next = { ...prev };
            let changed = false;

            if (hasTradEng && !hasTradCore && prev.traductor_tipo !== 'ENG') {
                next.traductor_tipo = 'ENG';
                changed = true;
            } else if (hasTradCore && !hasTradEng && prev.traductor_tipo !== 'CORE') {
                next.traductor_tipo = 'CORE';
                changed = true;
            }

            if (validRoles.length === 1 && prev.rol !== validRoles[0]) {
                next.rol = validRoles[0];
                changed = true;
            } else if (validRoles.length > 1 && prev.rol && !validRoles.includes(prev.rol)) {
                next.rol = '';
                changed = true;
            }

            return changed ? next : prev;
        });
    }, [formData.usuario_id, usuarios]);

    useEffect(() => {
        if (formData.rol !== 'Traductor') return;
        if (formData.traductor_tipo === 'CORE' && !canUseCoreTranslatorForSelection) {
            setFormData((prev) => ({ ...prev, traductor_tipo: 'ENG', capitulo: '' }));
            return;
        }
        if (formData.traductor_tipo === 'ENG' && !selectedUserHasTradEng) {
            setFormData((prev) => ({ ...prev, traductor_tipo: 'CORE', capitulo: '' }));
        }
    }, [formData.rol, formData.traductor_tipo, canUseCoreTranslatorForSelection, selectedUserHasTradEng]);

    useEffect(() => {
        if (formData.proyecto_id && formData.capitulo) {
            const proyecto = proyectos.find(p => p.id === parseInt(formData.proyecto_id));
            if (proyecto) {
                setFormData(prev => ({
                    ...prev,
                    descripcion: `${proyecto.titulo} - Capitulo ${formData.capitulo}`
                }));
            }
        }
    }, [formData.proyecto_id, formData.capitulo, proyectos]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setNotice(null);
        if (!formData.rol) {
            setNotice({ type: 'error', message: 'Selecciona un rol para continuar.' });
            return;
        }

        setLoading(true);
        try {
            const payload = {
                usuario_id: formData.usuario_id,
                rol: formData.rol,
                traductor_tipo: formData.rol === 'Traductor' ? formData.traductor_tipo : null,
                descripcion: formData.descripcion,
                proyecto_id: formData.proyecto_id ? parseInt(formData.proyecto_id) : null,
                capitulo: formData.capitulo ? parseFloat(formData.capitulo) : null
            };

            const res = await fetch('/api/asignaciones', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                router.push('/asignaciones');
            } else {
                const error = await res.json();
                setNotice({ type: 'error', message: error.error || 'No se pudo crear la asignacion' });
            }
        } catch {
            setNotice({ type: 'error', message: 'Error al crear la asignacion' });
        } finally {
            setLoading(false);
        }
    };

    const handleAutoAssign = async () => {
        setNotice(null);
        if (!formData.proyecto_id || !formData.usuario_id) {
            setNotice({ type: 'error', message: 'Selecciona proyecto y usuario antes de autoasignar.' });
            return;
        }

        setAutoLoading(true);
        try {
            const payload = {
                proyecto_id: Number(formData.proyecto_id),
                usuario_id: Number(formData.usuario_id),
                rol: formData.rol || undefined,
                traductor_tipo: formData.rol === 'Traductor' ? formData.traductor_tipo : undefined,
            };

            const res = await fetch('/api/asignaciones/auto', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await res.json();
            if (!res.ok) {
                if (data.requires_role_selection) {
                    setNotice({ type: 'info', message: 'Este usuario tiene mas de un rol. Selecciona el rol y vuelve a tirar.' });
                } else {
                    setNotice({ type: 'error', message: data.error || 'No se pudo autoasignar' });
                }
                return;
            }

            router.push('/asignaciones');
        } catch {
            setNotice({ type: 'error', message: 'Error al autoasignar' });
        } finally {
            setAutoLoading(false);
        }
    };

    return (
        <div className="flex-1 overflow-y-auto p-4 lg:p-8 bg-background-dark pb-32 md:pb-8">
            <div className="max-w-3xl mx-auto">
                <div className="mb-8">
                    <Link href="/asignaciones" className="text-muted-dark hover:text-white flex items-center gap-2 mb-4 w-fit transition-colors">
                        <span className="material-icons-round text-sm">arrow_back</span>
                        <span className="text-sm font-bold uppercase tracking-wider">Volver a la lista</span>
                    </Link>
                    <h1 className="font-display font-bold text-3xl text-white uppercase tracking-wider">Nueva Asignacion</h1>
                    <p className="text-muted-dark text-sm mt-1">Asigna una tarea o sortea un proyecto para tomar su siguiente capitulo disponible</p>
                </div>

                <div className="bg-surface-dark p-8 rounded-xl border border-gray-800 shadow-xl">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Proyecto</label>
                            <select
                                value={formData.proyecto_id}
                                onChange={(e) => setFormData((prev) => ({ ...prev, proyecto_id: e.target.value, capitulo: '', descripcion: '' }))}
                                className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary"
                                required
                            >
                                <option value="">Seleccionar proyecto...</option>
                                {proyectos.map(p => (
                                    <option key={p.id} value={String(p.id)}>{p.titulo}</option>
                                ))}
                            </select>
                        </div>

                        {formData.proyecto_id && (
                            <div className="flex items-center gap-3 p-4 bg-background-dark rounded-lg border border-gray-700">
                                <input
                                    type="checkbox"
                                    id="mostrar-reasignar"
                                    checked={mostrarReasignar}
                                    onChange={e => setMostrarReasignar(e.target.checked)}
                                    className="w-4 h-4 accent-primary"
                                />
                                <label htmlFor="mostrar-reasignar" className="text-sm text-gray-300 cursor-pointer">
                                    Mostrar capitulos no disponibles (solo para reasignar)
                                </label>
                            </div>
                        )}

                        <div>
                            <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Miembro del Staff</label>
                            <select
                                value={formData.usuario_id}
                                onChange={(e) => setFormData((prev) => ({ ...prev, usuario_id: e.target.value }))}
                                className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary"
                                required
                            >
                                <option value="">Seleccionar usuario...</option>
                                {usuarios
                                    .filter(u => {
                                        if (isAdmin) return true;
                                        if (isLeader) return u.grupo_id === user?.grupo_id;
                                        return false;
                                    })
                                    .map(u => (
                                        <option key={u.id} value={String(u.id)}>{u.nombre}</option>
                                    ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">
                                Rol / Tarea
                            </label>
                            <select
                                value={formData.rol}
                                onChange={(e) => setFormData((prev) => ({ ...prev, rol: e.target.value, capitulo: '' }))}
                                className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary"
                                required
                                disabled={rolesDisponiblesUsuario.length === 1}
                            >
                                <option value="">
                                    {rolesDisponiblesUsuario.length > 1
                                        ? 'Selecciona rol para este usuario...'
                                        : 'Selecciona usuario primero...'}
                                </option>
                                {rolesDisponiblesUsuario.map(roleName => (
                                    <option key={roleName} value={roleName}>{roleName}</option>
                                ))}
                            </select>
                            {rolesDisponiblesUsuario.length > 1 && (
                                <p className="text-xs text-muted-dark mt-2">Este usuario tiene varios roles, debes elegir con cual sortear.</p>
                            )}
                        </div>
                        {formData.rol === 'Traductor' && (
                            <div>
                                <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">
                                    Subrol Traductor
                                </label>
                                <select
                                    value={formData.traductor_tipo}
                                    onChange={(e) => setFormData((prev) => ({ ...prev, traductor_tipo: e.target.value, capitulo: '' }))}
                                    className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary"
                                >
                                    <option value="ENG" disabled={!selectedUserHasTradEng}>
                                        Traductor ENG
                                    </option>
                                    <option value="CORE" disabled={!canUseCoreTranslatorForSelection}>
                                        {`Traductor ${coreTranslatorLabel}`}
                                    </option>
                                </select>
                            </div>
                        )}

                        <div>
                            <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Capitulo</label>
                            <select
                                value={formData.capitulo}
                                onChange={(e) => setFormData((prev) => ({ ...prev, capitulo: e.target.value }))}
                                className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary"
                                required
                            >
                                <option value="">Seleccionar capitulo...</option>
                                {capitulos
                                    .map(c => {
                                        const isBlocked = c.status !== 'disponible' && !mostrarReasignar;
                                        const statusLabel = getRoleAwareStatusLabel(c.status, formData.rol);
                                        return (
                                            <option key={c.numero} value={c.numero} disabled={isBlocked}>
                                                [{statusLabel}] Capitulo {c.numero}
                                            </option>
                                        );
                                    })}
                            </select>
                            <p className="text-xs text-muted-dark mt-2">
                                {formData.rol
                                    ? 'Se muestran estados por rol segun Drive + asignaciones para evitar duplicados.'
                                    : 'Selecciona rol para ver estado real por capitulo.'}
                            </p>
                            {formData.proyecto_id && formData.rol && (
                                <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                                    <div className="px-2 py-1 rounded border border-gray-700 bg-background-dark text-gray-300">Total: {statusSummary.total}</div>
                                    <div className="px-2 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">{summaryLabels.disponible}: {statusSummary.disponible}</div>
                                    <div className="px-2 py-1 rounded border border-blue-500/30 bg-blue-500/10 text-blue-300">En proceso: {statusSummary.en_proceso}</div>
                                    <div className="px-2 py-1 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-300">{summaryLabels.completado}: {statusSummary.completado}</div>
                                    <div className="px-2 py-1 rounded border border-rose-500/30 bg-rose-500/10 text-rose-300">Bloqueados: {statusSummary.no_realizado}</div>
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Descripcion / Obra</label>
                            <input
                                type="text"
                                value={formData.descripcion}
                                onChange={(e) => setFormData((prev) => ({ ...prev, descripcion: e.target.value }))}
                                className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary"
                                placeholder="Ej. One Piece - Capitulo 1095"
                                required
                            />
                        </div>

                        {notice && (
                            <div className={`rounded-xl border px-4 py-3 ${notice.type === 'error'
                                ? 'bg-red-500/15 border-red-400/60 shadow-[0_0_20px_rgba(239,68,68,0.25)]'
                                : 'bg-blue-500/15 border-blue-400/60 shadow-[0_0_20px_rgba(59,130,246,0.25)]'
                                }`}>
                                <div className="flex items-start gap-3">
                                    <span className={`material-icons-round text-xl ${notice.type === 'error' ? 'text-red-300' : 'text-blue-300'}`}>
                                        {notice.type === 'error' ? 'error' : 'info'}
                                    </span>
                                    <div className="flex-1">
                                        <p className={`text-sm font-bold ${notice.type === 'error' ? 'text-red-200' : 'text-blue-200'}`}>
                                            {notice.type === 'error' ? 'No se pudo asignar este capitulo' : 'Aviso de autoasignacion'}
                                        </p>
                                        <p className={`text-sm mt-1 ${notice.type === 'error' ? 'text-red-100/90' : 'text-blue-100/90'}`}>
                                            {notice.message}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setNotice(null)}
                                        className="text-gray-300 hover:text-white transition-colors"
                                        aria-label="Cerrar aviso"
                                    >
                                        <span className="material-icons-round text-base">close</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                            <button
                                type="button"
                                onClick={handleAutoAssign}
                                disabled={autoLoading || !formData.proyecto_id || !formData.usuario_id || (rolesDisponiblesUsuario.length > 1 && !formData.rol)}
                                className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {autoLoading ? 'Sorteando...' : 'SORTEAR PROYECTO'}
                                <span className="material-icons-round">casino</span>
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-4 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {loading ? 'Asignando...' : 'CREAR ASIGNACION'}
                                <span className="material-icons-round">arrow_forward</span>
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default function NuevaAsignacion() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center text-white">Cargando...</div>}>
            <NuevaAsignacionContent />
        </Suspense>
    );
}
