'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatActivityDate } from '@/utils/date';
import { useUser } from '@/context/UserContext';
import { useSocket } from '@/context/SocketContext';

interface RoleRecord {
    asignacion_id: number;
    usuario: string;
    drive_url: string;
    completado_en?: string | null;
}

interface UsuarioOption {
    id: number;
    nombre: string;
    discord_username?: string;
    tag?: string;
    nombre_creditos?: string;
}

interface ProyectoOption {
    id: number;
    titulo: string;
}

interface CreditosRecord {
    traductor_tag?: string;
    typer_tag?: string;
    cleaner_tag?: string;
    traductor_alias?: string;
    typer_alias?: string;
    cleaner_alias?: string;
    traductor_display?: string;
    typer_display?: string;
    cleaner_display?: string;
    redraw_display?: string;
    plantilla_imagen?: {
        plantilla_url?: string;
        overlay_url?: string;
        font_file_id?: string;
        font_family?: string;
        font_size?: number | null;
        layout?: Record<string, unknown> | null;
    };
}

interface CompletadoItem {
    proyecto_id: number;
    proyecto_titulo: string;
    proyecto_imagen?: string;
    capitulo: number;
    completado_en: string;
    traductores: string;
    typers: string;
    redrawers: string;
    raw_url?: string;
    es_catalogo?: boolean;
    roles?: {
        traductor?: RoleRecord | null;
        typer?: RoleRecord | null;
        redrawer?: RoleRecord | null;
    };
    creditos?: CreditosRecord;
}

export default function CompletadosPage() {
    const { user, loading: userLoading } = useUser();
    const { socket } = useSocket();
    const [items, setItems] = useState<CompletadoItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedProject, setSelectedProject] = useState<string>('all');
    const [chapterFilter, setChapterFilter] = useState<string>('');
    const [chapterOrder, setChapterOrder] = useState<'recent' | 'asc' | 'desc'>('recent');
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [registroItem, setRegistroItem] = useState<CompletadoItem | null>(null);
    const [editingLinkRole, setEditingLinkRole] = useState<'Traductor' | 'Typer' | 'Redrawer' | null>(null);
    const [editLinkValue, setEditLinkValue] = useState('');
    const [staffUsers, setStaffUsers] = useState<UsuarioOption[]>([]);
    const [projectOptions, setProjectOptions] = useState<ProyectoOption[]>([]);
    const [roleUserSelection, setRoleUserSelection] = useState<{ traductor: string; typer: string; redrawer: string }>({
        traductor: '',
        typer: '',
        redrawer: '',
    });
    const [saving, setSaving] = useState(false);
    const [showCreateChapterModal, setShowCreateChapterModal] = useState(false);
    const [createProjectId, setCreateProjectId] = useState('');
    const [createChapterNumber, setCreateChapterNumber] = useState('');
    const [creatingChapter, setCreatingChapter] = useState(false);
    const [syncingDrive, setSyncingDrive] = useState(false);
    const [creditosForm, setCreditosForm] = useState({
        traductor_tag: '',
        traductor_alias: '',
        typer_tag: '',
        typer_alias: '',
        cleaner_tag: '',
        cleaner_alias: '',
    });
    const [layoutForm, setLayoutForm] = useState({
        names_x_pct: 32.6,
        traductor_y_pct: 25.3,
        typer_y_pct: 36.3,
        redraw_y_pct: 46.6,
        cleaner_y_pct: 58.3,
    });
    const [previewImageUrl, setPreviewImageUrl] = useState<string>('');
    const [previewLoading, setPreviewLoading] = useState(false);

    const isAdmin = user?.isAdmin || user?.roles?.includes('Administrador') || user?.role === 'admin';

    useEffect(() => {
        if (userLoading) return;
        if (!isAdmin) {
            setLoading(false);
            return;
        }

        fetchCompletados();
    }, [userLoading, isAdmin]);

    useEffect(() => {
        if (!socket || !isAdmin) return;
        const handleContentChanged = () => {
            fetchCompletados();
        };
        socket.on('content-changed', handleContentChanged);
        return () => { socket.off('content-changed', handleContentChanged); };
    }, [socket, isAdmin]);

    useEffect(() => {
        if (!isAdmin) return;
        fetch('/api/usuarios')
            .then((res) => res.json())
            .then((data) => {
                if (!Array.isArray(data)) return;
                const sorted = data
                    .filter((u: { activo?: number | string }) => Number(u?.activo ?? 1) === 1)
                    .map((u: { id: number | string; nombre?: string; discord_username?: string; tag?: string; nombre_creditos?: string }) => ({
                        id: Number(u.id),
                        nombre: String(u.nombre || ''),
                        discord_username: String(u.discord_username || '').trim(),
                        tag: String(u.tag || '').trim().toLowerCase(),
                        nombre_creditos: String(u.nombre_creditos || u.nombre || '').trim(),
                    }))
                    .filter((u) => Number.isFinite(u.id) && u.id > 0 && u.tag)
                    .sort((a, b) => String(a.tag || '').localeCompare(String(b.tag || '')));
                setStaffUsers(sorted);
            })
            .catch(() => {
                setStaffUsers([]);
            });
    }, [isAdmin]);

    useEffect(() => {
        if (!isAdmin) return;
        fetch('/api/proyectos')
            .then((res) => res.json())
            .then((data) => {
                if (!Array.isArray(data)) return;
                const sorted = data
                    .map((p: { id: number | string; titulo?: string }) => ({ id: Number(p.id), titulo: String(p.titulo || '') }))
                    .filter((p) => Number.isFinite(p.id) && p.id > 0 && p.titulo)
                    .sort((a, b) => a.titulo.localeCompare(b.titulo));
                setProjectOptions(sorted);
            })
            .catch(() => {
                setProjectOptions([]);
            });
    }, [isAdmin]);

    const fetchCompletados = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/completados');
            const data = await res.json();

            if (!res.ok) {
                setError(data?.error || 'No se pudo cargar completados');
                setItems([]);
                return;
            }

            setItems(Array.isArray(data) ? data : []);
        } catch {
            setError('Error de conexion');
            setItems([]);
        } finally {
            setLoading(false);
        }
    };

    const formatHandles = (raw: string) => {
        if (!raw) return '-';
        return raw
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean)
            .map((name) => (name.startsWith('@') ? name : `@${name}`))
            .join(', ');
    };

    const getRoleClasses = (role: 'Traductor' | 'Typer' | 'Redrawer') => {
        switch (role) {
            case 'Traductor':
                return {
                    label: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
                    value: 'text-cyan-300',
                };
            case 'Typer':
                return {
                    label: 'text-violet-300 bg-violet-500/10 border-violet-500/30',
                    value: 'text-violet-300',
                };
            case 'Redrawer':
                return {
                    label: 'text-orange-300 bg-orange-500/10 border-orange-500/30',
                    value: 'text-orange-300',
                };
            default:
                return {
                    label: 'text-gray-300 bg-gray-500/10 border-gray-500/30',
                    value: 'text-gray-300',
                };
        }
    };

    const uniqueProjects = useMemo(() => {
        return [...new Set(items.map((i) => i.proyecto_titulo))].sort((a, b) => a.localeCompare(b));
    }, [items]);

    const filteredItems = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        const base = items.filter((item) => {
            const byProject = selectedProject === 'all' || item.proyecto_titulo === selectedProject;
            const byChapter = !chapterFilter.trim() || String(item.capitulo).includes(chapterFilter.trim());
            const byText = !q || item.proyecto_titulo.toLowerCase().includes(q) || String(item.capitulo).includes(q);
            return byProject && byChapter && byText;
        });

        if (chapterOrder === 'asc') {
            return [...base].sort((a, b) => {
                if (Number(a.capitulo) !== Number(b.capitulo)) return Number(a.capitulo) - Number(b.capitulo);
                return String(a.proyecto_titulo).localeCompare(String(b.proyecto_titulo));
            });
        }

        if (chapterOrder === 'desc') {
            return [...base].sort((a, b) => {
                if (Number(a.capitulo) !== Number(b.capitulo)) return Number(b.capitulo) - Number(a.capitulo);
                return String(a.proyecto_titulo).localeCompare(String(b.proyecto_titulo));
            });
        }

        return base;
    }, [items, selectedProject, chapterFilter, searchTerm, chapterOrder]);

    const applyCreditosFromItem = (item: CompletadoItem | null) => {
        const c = item?.creditos || {};
        const normalizeHandle = (raw: string) => String(raw || '').trim().replace(/^@+/, '').toLowerCase();
        const inferTagFromRoleUser = (rawUser?: string) => {
            const key = normalizeHandle(rawUser || '');
            if (!key) return '';
            const match = staffUsers.find((u) => {
                const tag = String(u.tag || '').toLowerCase();
                const nombre = String(u.nombre || '').toLowerCase();
                const discord = String(u.discord_username || '').toLowerCase();
                return key === tag || key === nombre || key === discord;
            });
            return String(match?.tag || '');
        };

        const traductorAutoTag = inferTagFromRoleUser(item?.roles?.traductor?.usuario || '');
        const typerAutoTag = inferTagFromRoleUser(item?.roles?.typer?.usuario || '');
        const cleanerAutoTag = inferTagFromRoleUser(item?.roles?.redrawer?.usuario || '');

        const l = c.plantilla_imagen?.layout || {};
        const toPct = (value: unknown, fallback: number) => {
            const n = Number(value);
            if (!Number.isFinite(n)) return fallback;
            if (n > 0 && n <= 1) return Math.round(n * 10000) / 100;
            return fallback;
        };
        setCreditosForm({
            traductor_tag: String(c.traductor_tag || traductorAutoTag || ''),
            traductor_alias: String(c.traductor_alias || ''),
            typer_tag: String(c.typer_tag || typerAutoTag || ''),
            typer_alias: String(c.typer_alias || ''),
            cleaner_tag: String(c.cleaner_tag || cleanerAutoTag || ''),
            cleaner_alias: String(c.cleaner_alias || ''),
        });
        setLayoutForm({
            names_x_pct: toPct((l as Record<string, unknown>).names_x, 32.6),
            traductor_y_pct: toPct((l as Record<string, unknown>).traductor_y, 25.3),
            typer_y_pct: toPct((l as Record<string, unknown>).typer_y, 36.3),
            redraw_y_pct: toPct((l as Record<string, unknown>).redraw_y, 46.6),
            cleaner_y_pct: toPct((l as Record<string, unknown>).cleaner_y, 58.3),
        });
    };

    const openRegistro = (item: CompletadoItem) => {
        setRegistroItem(item);
        setEditingLinkRole(null);
        setEditLinkValue('');
        setRoleUserSelection({ traductor: '', typer: '', redrawer: '' });
        applyCreditosFromItem(item);
    };

    useEffect(() => {
        if (!registroItem) return;
        if (staffUsers.length === 0) return;
        const noTagsSelected =
            !String(creditosForm.traductor_tag || '').trim()
            && !String(creditosForm.typer_tag || '').trim()
            && !String(creditosForm.cleaner_tag || '').trim();
        if (!noTagsSelected) return;
        applyCreditosFromItem(registroItem);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [staffUsers, registroItem]);

    const roleToKey = (rol: 'Traductor' | 'Typer' | 'Redrawer'): 'traductor' | 'typer' | 'redrawer' => {
        if (rol === 'Traductor') return 'traductor';
        if (rol === 'Typer') return 'typer';
        return 'redrawer';
    };

    const startEditLink = (rol: 'Traductor' | 'Typer' | 'Redrawer', currentUrl?: string, currentUser?: string) => {
        setEditingLinkRole(rol);
        setEditLinkValue(currentUrl || '');
        const key = roleToKey(rol);
        const matchedUser = staffUsers.find((u) => String(u.nombre || '').toLowerCase() === String(currentUser || '').replace(/^@+/, '').toLowerCase());
        setRoleUserSelection((prev) => ({
            ...prev,
            [key]: matchedUser ? String(matchedUser.id) : prev[key],
        }));
    };

    const saveRoleLink = async () => {
        if (!registroItem || !editingLinkRole) return;
        setSaving(true);
        try {
            const res = await fetch('/api/completados', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proyecto_id: registroItem.proyecto_id,
                    capitulo: registroItem.capitulo,
                    rol: editingLinkRole,
                    drive_url: editLinkValue.trim(),
                    usuario_id: Number(roleUserSelection[roleToKey(editingLinkRole)] || 0) || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data?.error || 'No se pudo guardar');
                return;
            }
            setEditingLinkRole(null);
            setEditLinkValue('');
            await fetchCompletados();
            setRegistroItem(null);
        } catch {
            setError('Error de conexion al guardar');
        } finally {
            setSaving(false);
        }
    };

    const saveCreditos = async () => {
        if (!registroItem) return;
        setSaving(true);
        setError(null);
        try {
            const res = await fetch('/api/completados', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proyecto_id: registroItem.proyecto_id,
                    capitulo: registroItem.capitulo,
                    creditos: {
                        traductor_tag: creditosForm.traductor_tag,
                        traductor_alias: creditosForm.traductor_alias,
                        typer_tag: creditosForm.typer_tag,
                        typer_alias: creditosForm.typer_alias,
                        cleaner_tag: creditosForm.cleaner_tag,
                        cleaner_alias: creditosForm.cleaner_alias,
                    },
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data?.error || 'No se pudo guardar creditos');
                return;
            }

            await fetchCompletados();
            setRegistroItem((prev) => prev ? ({
                ...prev,
                creditos: {
                    ...prev.creditos,
                    traductor_tag: creditosForm.traductor_tag,
                    traductor_alias: creditosForm.traductor_alias,
                    typer_tag: creditosForm.typer_tag,
                    typer_alias: creditosForm.typer_alias,
                    cleaner_tag: creditosForm.cleaner_tag,
                    cleaner_alias: creditosForm.cleaner_alias,
                },
            }) : prev);
        } catch {
            setError('Error de conexion al guardar creditos');
        } finally {
            setSaving(false);
        }
    };

    const saveLayout = async () => {
        if (!registroItem) return;
        setSaving(true);
        setError(null);
        try {
            const payloadLayout = {
                names_x: Number(layoutForm.names_x_pct) / 100,
                traductor_y: Number(layoutForm.traductor_y_pct) / 100,
                typer_y: Number(layoutForm.typer_y_pct) / 100,
                redraw_y: Number(layoutForm.redraw_y_pct) / 100,
                cleaner_y: Number(layoutForm.cleaner_y_pct) / 100,
            };
            const res = await fetch('/api/completados', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proyecto_id: registroItem.proyecto_id,
                    capitulo: registroItem.capitulo,
                    plantilla_layout: payloadLayout,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data?.error || 'No se pudo guardar posicion');
                return;
            }
            setRegistroItem((prev) => prev ? ({
                ...prev,
                creditos: {
                    ...(prev.creditos || {}),
                    plantilla_imagen: {
                        ...(prev.creditos?.plantilla_imagen || {}),
                        layout: payloadLayout,
                    },
                },
            }) : prev);
        } catch {
            setError('Error de conexion al guardar posicion');
        } finally {
            setSaving(false);
        }
    };

    const saveGlobalLayoutAll = async () => {
        if (!registroItem) return;
        if (!confirm('¿Aplicar este layout a TODOS los proyectos? Esto sobreescribirá el layout guardado en cada proyecto.')) return;
        setSaving(true);
        setError(null);
        try {
            const payloadLayout = {
                names_x: Number(layoutForm.names_x_pct) / 100,
                traductor_y: Number(layoutForm.traductor_y_pct) / 100,
                typer_y: Number(layoutForm.typer_y_pct) / 100,
                redraw_y: Number(layoutForm.redraw_y_pct) / 100,
                cleaner_y: Number(layoutForm.cleaner_y_pct) / 100,
            };
            const res = await fetch('/api/completados', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proyecto_id: registroItem.proyecto_id,
                    capitulo: registroItem.capitulo,
                    apply_layout_all: payloadLayout,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data?.error || 'No se pudo aplicar layout a todos');
                return;
            }
        } catch {
            setError('Error de conexion al aplicar layout a todos');
        } finally {
            setSaving(false);
        }
    };

    const saveGlobalLayout = async () => {
        if (!registroItem) return;
        setSaving(true);
        setError(null);
        try {
            const payloadLayout = {
                names_x: Number(layoutForm.names_x_pct) / 100,
                traductor_y: Number(layoutForm.traductor_y_pct) / 100,
                typer_y: Number(layoutForm.typer_y_pct) / 100,
                redraw_y: Number(layoutForm.redraw_y_pct) / 100,
                cleaner_y: Number(layoutForm.cleaner_y_pct) / 100,
            };
            const res = await fetch('/api/completados', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proyecto_id: registroItem.proyecto_id,
                    capitulo: registroItem.capitulo,
                    layout_global_default: payloadLayout,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data?.error || 'No se pudo guardar default global');
                return;
            }
        } catch {
            setError('Error de conexion al guardar default global');
        } finally {
            setSaving(false);
        }
    };


    const createChapter = async () => {
        const projectId = Number(createProjectId);
        const chapterNumber = Number(createChapterNumber);
        if (!projectId || !Number.isFinite(chapterNumber) || chapterNumber <= 0) {
            setError('Debes seleccionar proyecto y un capitulo valido.');
            return;
        }

        setCreatingChapter(true);
        setError(null);
        try {
            const res = await fetch(`/api/proyectos/${projectId}/capitulos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ numero: chapterNumber }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data?.error || 'No se pudo crear el capitulo.');
                return;
            }

            setShowCreateChapterModal(false);
            setCreateChapterNumber('');
            await fetchCompletados();
        } catch {
            setError('Error de conexion al crear el capitulo.');
        } finally {
            setCreatingChapter(false);
        }
    };

    const syncSelectedProjectFromDrive = async () => {
        if (selectedProject === 'all') {
            setError('Selecciona una obra especifica para sincronizar desde Drive.');
            return;
        }

        const target = projectOptions.find((p) => p.titulo === selectedProject);
        if (!target?.id) {
            setError('No se encontro el proyecto seleccionado para sincronizar.');
            return;
        }

        setSyncingDrive(true);
        setError(null);
        try {
            const res = await fetch('/api/completados', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proyecto_id: target.id,
                    source: 'drive',
                    mode: 'role_folders',
                    dry_run: false,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data?.error || 'No se pudo sincronizar desde Drive.');
                return;
            }

            await fetchCompletados();
        } catch {
            setError('Error de conexion al sincronizar desde Drive.');
        } finally {
            setSyncingDrive(false);
        }
    };

    const renderRoleRow = (
        label: 'Traductor' | 'Typer' | 'Redraw',
        roleKey: 'traductor' | 'typer' | 'redrawer',
        classes: { label: string; value: string }
    ) => {
        const roleInfo = registroItem?.roles?.[roleKey];
        const selectedRoleUserId = roleUserSelection[roleKey] || '';
        const isEditingCurrent =
            (editingLinkRole === 'Traductor' && roleKey === 'traductor') ||
            (editingLinkRole === 'Typer' && roleKey === 'typer') ||
            (editingLinkRole === 'Redrawer' && roleKey === 'redrawer');

        return (
            <div className="border border-gray-800 rounded-xl p-3 bg-background-dark">
                <div className="flex items-center justify-between gap-2 mb-2">
                    <p className={`inline-flex items-center text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded border ${classes.label}`}>{label}</p>
                    <p className={`text-sm font-semibold ${classes.value}`}>{roleInfo?.usuario ? formatHandles(roleInfo.usuario) : '-'}</p>
                </div>
                {!isEditingCurrent ? (
                    <div className="flex flex-wrap gap-2">
                        {roleInfo?.drive_url ? (
                            <a
                                href={roleInfo.drive_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-bold"
                            >
                                <span className="material-icons-round text-sm">open_in_new</span>
                                Ir a Drive
                            </a>
                        ) : (
                            <span className="text-xs text-muted-dark">Sin enlace</span>
                        )}
                        <button
                            onClick={() => startEditLink(
                                roleKey === 'traductor' ? 'Traductor' : roleKey === 'typer' ? 'Typer' : 'Redrawer',
                                roleInfo?.drive_url || '',
                                roleInfo?.usuario || ''
                            )}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs font-bold"
                        >
                            <span className="material-icons-round text-sm">edit</span>
                            {roleInfo ? 'Editar enlace' : 'Agregar manual'}
                        </button>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <select
                            value={selectedRoleUserId}
                            onChange={(e) => setRoleUserSelection((prev) => ({ ...prev, [roleKey]: e.target.value }))}
                            className="w-full bg-surface-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                        >
                            <option value="">{roleInfo ? 'Mantener usuario actual' : 'Seleccionar usuario'}</option>
                            {staffUsers.map((u) => (
                                <option key={u.id} value={u.id}>{u.nombre}</option>
                            ))}
                        </select>
                        <input
                            type="url"
                            value={editLinkValue}
                            onChange={(e) => setEditLinkValue(e.target.value)}
                            className="w-full bg-surface-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                            placeholder="https://drive.google.com/... o https://docs.google.com/..."
                        />
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => {
                                    setEditingLinkRole(null);
                                    setEditLinkValue('');
                                }}
                                className="px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 text-xs font-bold"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={saveRoleLink}
                                disabled={saving}
                                className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-dark text-white text-xs font-bold disabled:opacity-60"
                            >
                                Guardar enlace
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const resolveStaffCreditsName = (tagValue: string) => {
        const normalized = String(tagValue || '').trim().toLowerCase();
        if (!normalized) return '';
        const user = staffUsers.find((u) => String(u.tag || '').toLowerCase() === normalized);
        return String(user?.nombre_creditos || user?.nombre || normalized);
    };

    const buildFinalCreditName = (tagValue: string, aliasValue: string) => {
        const alias = String(aliasValue || '').trim();
        if (alias) return alias;
        return resolveStaffCreditsName(tagValue);
    };

    const extractDriveFileId = (rawUrl: string) => {
        const value = String(rawUrl || '').trim();
        if (!value) return '';
        if (/^[A-Za-z0-9_-]{20,}$/.test(value)) return value;
        try {
            const url = new URL(value);
            const fileMatch = String(url.pathname || '').match(/\/file\/d\/([^/]+)/i);
            if (fileMatch?.[1]) return String(fileMatch[1]).trim();
            const idFromQuery = url.searchParams.get('id');
            if (idFromQuery) return String(idFromQuery).trim();
            return '';
        } catch {
            return '';
        }
    };

    const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('No se pudo cargar imagen'));
        img.src = src;
    });

    const loadCreditsFontFamily = async (rawFontFileValue: string, preferredFamily: string) => {
        const id = extractDriveFileId(rawFontFileValue);
        if (!id) return preferredFamily;
        const runtimeFamily = `credits-font-${id.slice(0, 8)}`;
        const fontFace = new FontFace(runtimeFamily, `url(/api/drive/font?id=${encodeURIComponent(id)})`);
        await fontFace.load();
        document.fonts.add(fontFace);
        return runtimeFamily;
    };

    const generateCreditsPreview = async (autoDownload = false) => {
        if (!registroItem) return;
        const baseTemplate = String(registroItem.creditos?.plantilla_imagen?.plantilla_url || '').trim();
        if (!baseTemplate) {
            setError('Este proyecto no tiene plantilla base configurada.');
            return;
        }

        setPreviewLoading(true);
        setError(null);
        try {
            const baseId = extractDriveFileId(baseTemplate);
            const overlayUrl = String(registroItem.creditos?.plantilla_imagen?.overlay_url || '').trim();
            const overlayId = extractDriveFileId(overlayUrl);
            const baseSrc = baseId ? `/api/drive/image?id=${encodeURIComponent(baseId)}` : baseTemplate;
            const overlaySrc = overlayUrl ? (overlayId ? `/api/drive/image?id=${encodeURIComponent(overlayId)}` : overlayUrl) : '';

            const baseImage = await loadImage(baseSrc);
            const overlayImage = overlaySrc ? await loadImage(overlaySrc).catch(() => null) : null;

            const canvas = document.createElement('canvas');
            canvas.width = baseImage.naturalWidth || baseImage.width;
            canvas.height = baseImage.naturalHeight || baseImage.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('No se pudo iniciar canvas');

            const width = canvas.width;
            const height = canvas.height;
            const configuredFamily = String(registroItem.creditos?.plantilla_imagen?.font_family || 'Komika Title');
            const configuredFontFile = String(registroItem.creditos?.plantilla_imagen?.font_file_id || '').trim();
            const fontFamily = await loadCreditsFontFamily(configuredFontFile, configuredFamily).catch(() => configuredFamily);
            const mainFontPx = Number(registroItem.creditos?.plantilla_imagen?.font_size || 48) || 48;
            const layout = registroItem.creditos?.plantilla_imagen?.layout || {};
            const toPx = (value: unknown, fallback: number, total: number) => {
                const n = Number(value);
                if (!Number.isFinite(n)) return fallback;
                if (n > 0 && n <= 1) return n * total;
                if (n > 1) return n;
                return fallback;
            };

            ctx.drawImage(baseImage, 0, 0, width, height);
            if (overlayImage) {
                ctx.drawImage(overlayImage, 0, 0, width, height);
            }

            ctx.textAlign = 'left';
            ctx.lineJoin = 'round';
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = 'transparent';
            ctx.lineWidth = 0;
            ctx.font = `700 ${Math.round(mainFontPx)}px "${fontFamily}", sans-serif`;

            const rows = [
                buildFinalCreditName(creditosForm.traductor_tag, creditosForm.traductor_alias) || '-',
                buildFinalCreditName(creditosForm.typer_tag, creditosForm.typer_alias) || '-',
                buildFinalCreditName(creditosForm.cleaner_tag, creditosForm.cleaner_alias) || '-',
                buildFinalCreditName(creditosForm.cleaner_tag, creditosForm.cleaner_alias) || '-',
            ];
            const namesY = [
                toPx(Number(layoutForm.traductor_y_pct) / 100 || (layout as Record<string, unknown>).traductor_y, height * 0.253, height),
                toPx(Number(layoutForm.typer_y_pct) / 100 || (layout as Record<string, unknown>).typer_y, height * 0.363, height),
                toPx(Number(layoutForm.redraw_y_pct) / 100 || (layout as Record<string, unknown>).redraw_y, height * 0.466, height),
                toPx(Number(layoutForm.cleaner_y_pct) / 100 || (layout as Record<string, unknown>).cleaner_y, height * 0.583, height),
            ];
            const namesX = toPx(Number(layoutForm.names_x_pct) / 100 || (layout as Record<string, unknown>).names_x, width * 0.326, width);
            rows.forEach((name, index) => {
                ctx.fillText(String(name || '-'), namesX, namesY[index]);
            });

            const outputUrl = canvas.toDataURL('image/png');
            setPreviewImageUrl(outputUrl);

            if (autoDownload) {
                const a = document.createElement('a');
                a.href = outputUrl;
                a.download = `${String(registroItem.proyecto_titulo || 'creditos').replace(/[^a-z0-9]+/gi, '_')}_cap_${String(registroItem.capitulo)}.png`;
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'No se pudo generar preview');
        } finally {
            setPreviewLoading(false);
        }
    };

    if (!userLoading && !isAdmin) {
        return (
            <div className="flex-1 flex items-center justify-center bg-background-dark text-muted-dark p-6">
                Solo administradores pueden ver esta vista.
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col h-full bg-background-dark overflow-hidden">
            <header className="h-20 bg-surface-dark border-b border-gray-800 hidden md:flex items-center justify-between px-6 lg:px-8 z-10 sticky top-0 shrink-0">
                <h1 className="font-display font-bold text-2xl lg:text-3xl uppercase tracking-wider text-white">
                    <span className="text-primary">Completados</span>
                </h1>
            </header>

            <div className="flex-1 overflow-y-auto p-4 lg:p-8 pb-32 md:pb-8">
                <div className="max-w-6xl mx-auto space-y-4">
                    {!loading && !error && (
                        <div className="bg-surface-dark border border-gray-800 rounded-xl p-4 space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Buscar obra o capitulo..."
                                    className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-primary"
                                />
                                <select
                                    value={selectedProject}
                                    onChange={(e) => setSelectedProject(e.target.value)}
                                    className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                                >
                                    <option value="all">Todas las obras</option>
                                    {uniqueProjects.map((title) => (
                                        <option key={title} value={title}>{title}</option>
                                    ))}
                                </select>
                                <input
                                    type="text"
                                    value={chapterFilter}
                                    onChange={(e) => setChapterFilter(e.target.value)}
                                    placeholder="Filtrar capitulo (ej: 4.1)"
                                    className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-primary"
                                />
                                <select
                                    value={chapterOrder}
                                    onChange={(e) => setChapterOrder(e.target.value as 'recent' | 'asc' | 'desc')}
                                    className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                                >
                                    <option value="recent">Orden: Recientes</option>
                                    <option value="asc">Capitulo: Menor a mayor</option>
                                    <option value="desc">Capitulo: Mayor a menor</option>
                                </select>
                            </div>
                            <div className="flex justify-end">
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={syncSelectedProjectFromDrive}
                                        disabled={syncingDrive || selectedProject === 'all'}
                                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-60"
                                    >
                                        <span className="material-icons-round text-base">sync</span>
                                        {syncingDrive ? 'Sincronizando...' : 'Sync Drive'}
                                    </button>
                                    <button
                                        onClick={() => {
                                            setCreateProjectId('');
                                            setCreateChapterNumber('');
                                            setShowCreateChapterModal(true);
                                        }}
                                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary hover:bg-primary-dark text-white text-xs font-bold uppercase tracking-wider"
                                    >
                                        <span className="material-icons-round text-base">add</span>
                                        Crear capitulo
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {loading ? (
                        [...Array(5)].map((_, i) => (
                            <div key={i} className="bg-surface-dark border border-gray-800 rounded-2xl p-5 animate-pulse">
                                <div className="h-5 w-56 bg-gray-800/50 rounded mb-4"></div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="h-12 bg-gray-800/50 rounded"></div>
                                    <div className="h-12 bg-gray-800/50 rounded"></div>
                                    <div className="h-12 bg-gray-800/50 rounded"></div>
                                </div>
                            </div>
                        ))
                    ) : error ? (
                        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-4">{error}</div>
                    ) : filteredItems.length === 0 ? (
                        <div className="bg-surface-dark border border-gray-800 rounded-xl p-8 text-center text-muted-dark">
                            No hay resultados con ese filtro.
                        </div>
                    ) : (
                        filteredItems.map((item) => (
                            <article key={`${item.proyecto_id}-${item.capitulo}`} className="bg-surface-dark border border-gray-800 rounded-2xl overflow-hidden shadow-lg relative">
                                <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${item.es_catalogo ? 'bg-blue-500' : 'bg-emerald-500'}`}></div>
                                <div className="p-5 pl-6">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className="w-16 h-20 rounded-lg overflow-hidden bg-surface-darker border border-gray-700 shrink-0">
                                                <img
                                                    src={item.proyecto_imagen || 'https://via.placeholder.com/120x180?text=No+Cover'}
                                                    alt={item.proyecto_titulo}
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            </div>
                                            <div className="min-w-0">
                                                <h3 className="text-white font-display font-bold text-lg line-clamp-2">
                                                    {item.proyecto_titulo}
                                                </h3>
                                                <div className="mt-1 inline-flex items-center px-2 py-0.5 rounded-md border border-primary/30 bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider">
                                                    Capitulo {item.capitulo}
                                                </div>
                                                <p className="text-xs text-muted-dark mt-1">
                                                    {item.completado_en ? formatActivityDate(item.completado_en) : ''}
                                                </p>
                                            </div>
                                        </div>
                                        <span className={`text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-md border ${item.es_catalogo
                                            ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                                            : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                            }`}>
                                            {item.es_catalogo ? 'Catalogo' : 'Completado'}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5 pt-4 border-t border-gray-800">
                                        <div>
                                            <p className={`inline-flex items-center text-[10px] uppercase tracking-wider font-bold mb-1 px-2 py-0.5 rounded border ${getRoleClasses('Traductor').label}`}>Traductor</p>
                                            <p className={`font-semibold ${getRoleClasses('Traductor').value}`}>{formatHandles(item.traductores)}</p>
                                        </div>
                                        <div>
                                            <p className={`inline-flex items-center text-[10px] uppercase tracking-wider font-bold mb-1 px-2 py-0.5 rounded border ${getRoleClasses('Typer').label}`}>Typer</p>
                                            <p className={`font-semibold ${getRoleClasses('Typer').value}`}>{formatHandles(item.typers)}</p>
                                        </div>
                                        <div>
                                            <p className={`inline-flex items-center text-[10px] uppercase tracking-wider font-bold mb-1 px-2 py-0.5 rounded border ${getRoleClasses('Redrawer').label}`}>Redraw</p>
                                            <p className={`font-semibold ${getRoleClasses('Redrawer').value}`}>{formatHandles(item.redrawers)}</p>
                                        </div>
                                    </div>
                                    <div className="mt-4 pt-3 border-t border-gray-800 flex justify-end">
                                        <button
                                            onClick={() => openRegistro(item)}
                                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:text-white hover:border-primary hover:bg-primary/10 transition-colors text-xs font-bold uppercase tracking-wider"
                                        >
                                            <span className="material-icons-round text-base">visibility</span>
                                            Ver Registro
                                        </button>
                                    </div>
                                </div>
                            </article>
                        ))
                    )}
                </div>
            </div>

            {registroItem && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                    <div className="bg-surface-dark w-full max-w-2xl rounded-2xl border border-gray-800 shadow-2xl overflow-hidden animate-fade-in max-h-[90vh] flex flex-col">
                        <div className="bg-surface-darker p-4 border-b border-gray-800 flex justify-between items-center">
                            <h3 className="font-display font-bold text-xl text-white">
                                Registro Capitulo {registroItem.capitulo}
                            </h3>
                            <button onClick={() => setRegistroItem(null)} className="text-gray-400 hover:text-white">
                                <span className="material-icons-round">close</span>
                            </button>
                        </div>
                        <div className="p-6 space-y-4 overflow-y-auto">
                            <p className="text-sm text-gray-300">{registroItem.proyecto_titulo}</p>
                            {registroItem.raw_url && (
                                <a
                                    href={registroItem.raw_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-500/10 border border-gray-600 text-gray-300 text-xs font-bold"
                                >
                                    <span className="material-icons-round text-sm">menu_book</span>
                                    RAW del capitulo
                                </a>
                            )}
                            {renderRoleRow('Traductor', 'traductor', getRoleClasses('Traductor'))}
                            {renderRoleRow('Typer', 'typer', getRoleClasses('Typer'))}
                            {renderRoleRow('Redraw', 'redrawer', getRoleClasses('Redrawer'))}
                            <div className="border border-gray-800 rounded-xl p-4 bg-background-dark space-y-3">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs uppercase tracking-wider font-bold text-primary">Creditos</p>
                                    <button
                                        onClick={saveCreditos}
                                        disabled={saving}
                                        className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-dark text-white text-xs font-bold disabled:opacity-60"
                                    >
                                        Guardar creditos
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    <select
                                        value={creditosForm.traductor_tag}
                                        onChange={(e) => setCreditosForm((prev) => ({ ...prev, traductor_tag: e.target.value }))}
                                        className="bg-surface-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                                    >
                                        <option value="">Tag traductor...</option>
                                        {staffUsers.map((u) => (
                                            <option key={`trad-${u.id}`} value={String(u.tag || '')}>{String(u.tag || '')}</option>
                                        ))}
                                    </select>
                                    <input
                                        type="text"
                                        value={creditosForm.traductor_alias}
                                        onChange={(e) => setCreditosForm((prev) => ({ ...prev, traductor_alias: e.target.value }))}
                                        className="bg-surface-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                                        placeholder="Alias traductor (opcional)"
                                    />

                                    <select
                                        value={creditosForm.typer_tag}
                                        onChange={(e) => setCreditosForm((prev) => ({ ...prev, typer_tag: e.target.value }))}
                                        className="bg-surface-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                                    >
                                        <option value="">Tag typer...</option>
                                        {staffUsers.map((u) => (
                                            <option key={`typ-${u.id}`} value={String(u.tag || '')}>{String(u.tag || '')}</option>
                                        ))}
                                    </select>
                                    <input
                                        type="text"
                                        value={creditosForm.typer_alias}
                                        onChange={(e) => setCreditosForm((prev) => ({ ...prev, typer_alias: e.target.value }))}
                                        className="bg-surface-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                                        placeholder="Alias typer (opcional)"
                                    />

                                    <select
                                        value={creditosForm.cleaner_tag}
                                        onChange={(e) => setCreditosForm((prev) => ({ ...prev, cleaner_tag: e.target.value }))}
                                        className="bg-surface-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                                    >
                                        <option value="">Tag cleaner...</option>
                                        {staffUsers.map((u) => (
                                            <option key={`cln-${u.id}`} value={String(u.tag || '')}>{String(u.tag || '')}</option>
                                        ))}
                                    </select>
                                    <input
                                        type="text"
                                        value={creditosForm.cleaner_alias}
                                        onChange={(e) => setCreditosForm((prev) => ({ ...prev, cleaner_alias: e.target.value }))}
                                        className="bg-surface-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                                        placeholder="Alias cleaner (opcional)"
                                    />
                                </div>

                                <div className="text-[11px] text-muted-dark space-y-1">
                                    <p>Traductor final: {buildFinalCreditName(creditosForm.traductor_tag, creditosForm.traductor_alias) || '-'}</p>
                                    <p>Typer final: {buildFinalCreditName(creditosForm.typer_tag, creditosForm.typer_alias) || '-'}</p>
                                    <p>Cleaner final: {buildFinalCreditName(creditosForm.cleaner_tag, creditosForm.cleaner_alias) || '-'}</p>
                                    <p>Redraw final: {buildFinalCreditName(creditosForm.cleaner_tag, creditosForm.cleaner_alias) || '-'}</p>
                                    <p>Plantilla del proyecto: {registroItem?.creditos?.plantilla_imagen?.plantilla_url || '-'}</p>
                                    <p>Fuente plantilla: {registroItem?.creditos?.plantilla_imagen?.font_family || 'Komika Title'} {registroItem?.creditos?.plantilla_imagen?.font_size || 48}px</p>
                                </div>
                                <div className="border-t border-gray-800 pt-3 space-y-2">
                                    <div className="rounded-lg border border-gray-700 bg-background-dark p-3 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs uppercase tracking-wider font-bold text-blue-300">Posicion Texto (%)</p>
                                            <div className="flex gap-1.5">
                                                <button
                                                    onClick={saveLayout}
                                                    disabled={saving}
                                                    className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold disabled:opacity-60"
                                                >
                                                    Guardar proyecto
                                                </button>
                                                <button
                                                    onClick={saveGlobalLayout}
                                                    disabled={saving}
                                                    className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold disabled:opacity-60"
                                                >
                                                    Default global
                                                </button>
                                                <button
                                                    onClick={saveGlobalLayoutAll}
                                                    disabled={saving}
                                                    className="px-2.5 py-1 rounded-lg bg-purple-700 hover:bg-purple-800 text-white text-[11px] font-bold disabled:opacity-60"
                                                    title="Aplica este layout a todos los proyectos"
                                                >
                                                    Aplicar a todos
                                                </button>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            <label className="text-[11px] text-gray-300 flex items-center gap-2">
                                                X nombres
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={100}
                                                    step={0.1}
                                                    value={layoutForm.names_x_pct}
                                                    onChange={(e) => setLayoutForm((prev) => ({ ...prev, names_x_pct: Number(e.target.value) }))}
                                                    className="flex-1"
                                                />
                                                <span className="w-10 text-right">{layoutForm.names_x_pct.toFixed(1)}</span>
                                            </label>
                                            <label className="text-[11px] text-gray-300 flex items-center gap-2">
                                                Y traductor
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={100}
                                                    step={0.1}
                                                    value={layoutForm.traductor_y_pct}
                                                    onChange={(e) => setLayoutForm((prev) => ({ ...prev, traductor_y_pct: Number(e.target.value) }))}
                                                    className="flex-1"
                                                />
                                                <span className="w-10 text-right">{layoutForm.traductor_y_pct.toFixed(1)}</span>
                                            </label>
                                            <label className="text-[11px] text-gray-300 flex items-center gap-2">
                                                Y typer
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={100}
                                                    step={0.1}
                                                    value={layoutForm.typer_y_pct}
                                                    onChange={(e) => setLayoutForm((prev) => ({ ...prev, typer_y_pct: Number(e.target.value) }))}
                                                    className="flex-1"
                                                />
                                                <span className="w-10 text-right">{layoutForm.typer_y_pct.toFixed(1)}</span>
                                            </label>
                                            <label className="text-[11px] text-gray-300 flex items-center gap-2">
                                                Y redraw
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={100}
                                                    step={0.1}
                                                    value={layoutForm.redraw_y_pct}
                                                    onChange={(e) => setLayoutForm((prev) => ({ ...prev, redraw_y_pct: Number(e.target.value) }))}
                                                    className="flex-1"
                                                />
                                                <span className="w-10 text-right">{layoutForm.redraw_y_pct.toFixed(1)}</span>
                                            </label>
                                            <label className="text-[11px] text-gray-300 flex items-center gap-2 md:col-span-2">
                                                Y cleaner
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={100}
                                                    step={0.1}
                                                    value={layoutForm.cleaner_y_pct}
                                                    onChange={(e) => setLayoutForm((prev) => ({ ...prev, cleaner_y_pct: Number(e.target.value) }))}
                                                    className="flex-1"
                                                />
                                                <span className="w-10 text-right">{layoutForm.cleaner_y_pct.toFixed(1)}</span>
                                            </label>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            onClick={() => generateCreditsPreview(false)}
                                            disabled={previewLoading}
                                            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-60"
                                        >
                                            {previewLoading ? 'Generando...' : 'Visualizar plantilla'}
                                        </button>
                                        <button
                                            onClick={() => generateCreditsPreview(true)}
                                            disabled={previewLoading}
                                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-60"
                                        >
                                            Descargar PNG
                                        </button>
                                    </div>
                                    {previewImageUrl && (
                                        <div className="rounded-lg border border-gray-700 bg-background-dark p-2 max-h-[60vh] overflow-auto">
                                            <img src={previewImageUrl} alt="Preview creditos" className="w-full h-auto rounded" />
                                        </div>
                                    )}
                                </div>

                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showCreateChapterModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                    <div className="bg-surface-dark w-full max-w-xl rounded-2xl border border-gray-800 shadow-2xl overflow-hidden animate-fade-in">
                        <div className="bg-surface-darker p-4 border-b border-gray-800 flex justify-between items-center">
                            <h3 className="font-display font-bold text-xl text-white">Crear Capitulo</h3>
                            <button
                                onClick={() => setShowCreateChapterModal(false)}
                                className="text-gray-400 hover:text-white"
                            >
                                <span className="material-icons-round">close</span>
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <select
                                value={createProjectId}
                                onChange={(e) => setCreateProjectId(e.target.value)}
                                className="w-full bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                            >
                                <option value="">Selecciona proyecto...</option>
                                {projectOptions.map((project) => (
                                    <option key={project.id} value={project.id}>{project.titulo}</option>
                                ))}
                            </select>
                            <input
                                type="number"
                                step="0.1"
                                value={createChapterNumber}
                                onChange={(e) => setCreateChapterNumber(e.target.value)}
                                placeholder="Capitulo (ej: 1 o 7.5)"
                                className="w-full bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                            />
                            <div className="text-[11px] text-muted-dark">
                                Esto crea el capitulo en el catalogo del proyecto para que luego puedas sincronizar/reconciliar enlaces desde Drive.
                            </div>
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setShowCreateChapterModal(false)}
                                    className="px-3 py-2 rounded-lg border border-gray-700 text-gray-300 text-xs font-bold"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={createChapter}
                                    disabled={creatingChapter}
                                    className="px-3 py-2 rounded-lg bg-primary hover:bg-primary-dark text-white text-xs font-bold disabled:opacity-60"
                                >
                                    {creatingChapter ? 'Creando...' : 'Crear capitulo'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
