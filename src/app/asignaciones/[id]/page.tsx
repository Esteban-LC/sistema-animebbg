'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { formatActivityDate } from '@/utils/date';
import Link from 'next/link';
import { useToast } from '@/context/ToastContext';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useUser } from '@/context/UserContext';
import { useSocket } from '@/context/SocketContext';

interface Asignacion {
    id: number;
    usuario_id: number;
    proyecto_id?: number;
    proyecto_titulo?: string;
    capitulo?: number;
    rol: string;
    traductor_tipo?: 'CORE' | 'ENG' | null;
    descripcion: string;
    estado: string;
    asignado_en: string;
    usuario_nombre: string;
    informe?: string;
    discord_username?: string;
    drive_url?: string;
    raw_url?: string;
    raw_eng_url?: string;
    core_raw_label?: string;
}

interface DriveImageItem {
    id: string;
    name: string;
    mimeType: string;
    view_url: string;
    thumb_url: string;
}

interface FontGuideItem {
    id: string;
    nombre: string;
    para: string;
    ejemplo: string;
    estilo?: 'normal' | 'italic';
    font_file_id?: string;
}

interface ProjectFontsConfig {
    titulo: string;
    simbolos_url: string;
    fuentes_drive_url: string;
    items: FontGuideItem[];
}

const DEFAULT_PROJECT_FONTS_CONFIG: ProjectFontsConfig = {
    titulo: 'Guia de Tipografias',
    simbolos_url: '',
    fuentes_drive_url: '',
    items: [
        { id: 'wild-words', nombre: 'Wild Words', para: 'Dialogos principales', ejemplo: 'iESTO ES UN DIALOGO!', estilo: 'italic' },
        { id: 'death-killer', nombre: 'Death Killer', para: 'Onomatopeyas y SFX', ejemplo: 'iBOOOM!', estilo: 'italic' },
        { id: 'cc-digital', nombre: 'CC Digital Delivery', para: 'Pensamientos internos', ejemplo: '...', estilo: 'normal' },
    ],
};

function normalizeProjectFontsConfig(raw: unknown): ProjectFontsConfig {
    if (!raw || typeof raw !== 'object') return DEFAULT_PROJECT_FONTS_CONFIG;
    const value = raw as Partial<ProjectFontsConfig>;
    const itemsRaw: unknown[] = Array.isArray(value.items)
        ? (value.items as unknown[])
        : (DEFAULT_PROJECT_FONTS_CONFIG.items as unknown[]);
    const items = itemsRaw
        .map((item, index) => {
            const data = (item && typeof item === 'object') ? item as Partial<FontGuideItem> : {};
            const legacy = (item && typeof item === 'object') ? (item as Record<string, unknown>) : {};
            return {
                id: String(data.id || `fuente-${index + 1}`),
                nombre: String(data.nombre || `Fuente ${index + 1}`),
                para: String(legacy.para || legacy.uso || legacy.etiqueta || legacy.subtitulo || ''),
                ejemplo: String(data.ejemplo || 'Ejemplo'),
                estilo: String(data.estilo || '').toLowerCase() === 'normal' ? 'normal' : 'italic',
                font_file_id: String(data.font_file_id || '').trim(),
            } as FontGuideItem;
        })
        .filter((item) => item.nombre.trim().length > 0);

    return {
        titulo: String(value.titulo || DEFAULT_PROJECT_FONTS_CONFIG.titulo),
        simbolos_url: String(value.simbolos_url || ''),
        fuentes_drive_url: String(value.fuentes_drive_url || ''),
        items: items.length > 0 ? items : DEFAULT_PROJECT_FONTS_CONFIG.items,
    };
}

function getErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
}

function normalizeUrlValue(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function isValidDeliveryUrlForRole(role: string, rawUrl: string) {
    const value = normalizeUrlValue(rawUrl);
    if (!value) return false;
    try {
        const url = new URL(value);
        const host = String(url.hostname || '').toLowerCase();
        const path = String(url.pathname || '').toLowerCase();
        const roleLower = String(role || '').toLowerCase();

        if (roleLower === 'traductor') {
            return host.includes('docs.google.com') && path.includes('/document/');
        }
        if (roleLower === 'typer' || roleLower === 'redrawer') {
            if (!host.includes('drive.google.com')) return false;
            const hasFolderPath = /\/drive\/folders\/[^/?#]+/i.test(path);
            const hasFolderOpenId = path.includes('/open') && !!url.searchParams.get('id');
            return hasFolderPath || hasFolderOpenId;
        }
        return true;
    } catch {
        return false;
    }
}

function getDeliveryPlaceholder(role: string) {
    const roleLower = String(role || '').toLowerCase();
    if (roleLower === 'traductor') return 'https://docs.google.com/document/d/...';
    if (roleLower === 'typer' || roleLower === 'redrawer') return 'https://drive.google.com/drive/folders/...';
    return 'https://...';
}

function getDriveLinkType(rawUrl: string): 'file' | 'folder' | 'other' {
    if (!rawUrl) return 'other';
    try {
        const url = new URL(rawUrl);
        const isDrive = url.hostname.includes('drive.google.com');
        if (!isDrive) return 'other';
        if (/\/file\/d\/[^/]+/.test(url.pathname)) return 'file';
        if (/\/drive\/folders\/[^/?#]+/.test(url.pathname)) return 'folder';
        if (url.searchParams.get('id') && (url.pathname.includes('/drive/folders') || url.pathname.includes('/open'))) {
            return 'folder';
        }
        return 'other';
    } catch {
        return 'other';
    }
}

function toDrivePreviewUrl(rawUrl: string) {
    if (!rawUrl) return '';
    try {
        const url = new URL(rawUrl);
        const isDrive = url.hostname.includes('drive.google.com');
        if (!isDrive) return rawUrl;

        const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
        if (fileMatch?.[1]) {
            return `https://drive.google.com/file/d/${fileMatch[1]}/preview`;
        }

        return '';
    } catch {
        return '';
    }
}

export default function DetalleAsignacion() {
    const router = useRouter();
    const params = useParams<{ id: string }>();
    const searchParams = useSearchParams();
    const id = String(params?.id || '');
    const { user } = useUser();
    const { showToast } = useToast();
    const { socket } = useSocket();

    const [asignacion, setAsignacion] = useState<Asignacion | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [nuevoInforme, setNuevoInforme] = useState('');
    const [driveUrl, setDriveUrl] = useState('');
    const [deliveryUrl, setDeliveryUrl] = useState('');
    const [manualCapitulo, setManualCapitulo] = useState('');
    const [manualDriveUrl, setManualDriveUrl] = useState('');
    const [driveImages, setDriveImages] = useState<DriveImageItem[]>([]);
    const [driveImagesLoading, setDriveImagesLoading] = useState(false);
    const [driveImagesError, setDriveImagesError] = useState('');
    const [selectedImageIndex, setSelectedImageIndex] = useState(0);
    const [imageZoom, setImageZoom] = useState(1);
    const [selectedRawVariant, setSelectedRawVariant] = useState<'CORE' | 'ENG'>('CORE');
    const [isSymbolsGuideOpen, setIsSymbolsGuideOpen] = useState(true);
    const [isTyperGuideOpen, setIsTyperGuideOpen] = useState(true);
    const [projectFontsConfig, setProjectFontsConfig] = useState<ProjectFontsConfig>(DEFAULT_PROJECT_FONTS_CONFIG);
    const [assignmentFontFamilies, setAssignmentFontFamilies] = useState<Record<string, string>>({});

    const [usuarios, setUsuarios] = useState<{ id: number; nombre: string }[]>([]);
    const [showReassignModal, setShowReassignModal] = useState(false);
    const [selectedUser, setSelectedUser] = useState('');
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [showCompleteModal, setShowCompleteModal] = useState(false);
    const [showCompleteConfirmModal, setShowCompleteConfirmModal] = useState(false);
    const [showCompleteFinalModal, setShowCompleteFinalModal] = useState(false);
    const [completionLink, setCompletionLink] = useState('');

    const isAdmin = user?.roles?.includes('Administrador');
    const isStaffView = searchParams.get('staff') === '1';
    const assignmentRole = String(asignacion?.rol || '').toLowerCase();
    const isTraductor = assignmentRole === 'traductor';
    const isTyper = assignmentRole === 'typer';
    const isTyperOrRedrawer = assignmentRole === 'typer' || assignmentRole === 'redrawer';
    const isTyperInProgress = isTyper && String(asignacion?.estado || '') === 'En Proceso';
    const isTraductorInProgress = isTraductor && String(asignacion?.estado || '') === 'En Proceso';
    const canSeeRawControls = isTyper || isTraductorInProgress;
    const currentDriveUrl = driveUrl || asignacion?.drive_url || '';
    const engRawUrl = normalizeUrlValue(asignacion?.raw_url);
    const coreRawUrl = normalizeUrlValue(asignacion?.raw_eng_url);
    const coreRawLabel = String(asignacion?.core_raw_label || 'KO/JAP');
    const hasCoreRaw = !!coreRawUrl;
    const hasEngRaw = !!engRawUrl;
    const canToggleRawVariant = isTraductor || isTyper;
    const activeRawVariant = selectedRawVariant === 'ENG' && hasEngRaw ? 'ENG' : (hasCoreRaw ? 'CORE' : 'ENG');
    const selectedRawUrl = activeRawVariant === 'ENG' ? engRawUrl : coreRawUrl;
    const selectedRawLabel = activeRawVariant === 'ENG' ? 'RAW ENG' : `RAW ${coreRawLabel}`;
    const viewerDriveUrl = isTraductor
        ? (isTraductorInProgress ? (selectedRawUrl || currentDriveUrl) : '')
        : currentDriveUrl;
    const viewerDriveLinkType = getDriveLinkType(viewerDriveUrl);
    const previewUrl = toDrivePreviewUrl(viewerDriveUrl);
    const selectedImage = driveImages[selectedImageIndex] || null;
    const assignmentFontsItems = useMemo(() => projectFontsConfig.items, [projectFontsConfig.items]);
    const assignmentFontsSignature = assignmentFontsItems
        .map((item) => `${item.id}:${String(item.font_file_id || '').trim()}`)
        .join('|');

    const zoomOut = () => setImageZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10));
    const zoomIn = () => setImageZoom((z) => Math.min(3, Math.round((z + 0.1) * 10) / 10));
    const resetZoom = () => setImageZoom(1);
    const goPrevImage = () => setSelectedImageIndex((idx) => Math.max(0, idx - 1));
    const goNextImage = () => setSelectedImageIndex((idx) => Math.min(driveImages.length - 1, idx + 1));

    useEffect(() => {
        if (!id) {
            setLoading(false);
            return;
        }

        const fetchDetails = () => {
            fetch(`/api/asignaciones/${id}`)
                .then(async (res) => {
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                        throw new Error(data?.error || `Error al cargar (${res.status})`);
                    }
                    return data;
                })
                .then(data => {
                    setLoadError('');
                    setAsignacion(data);
                    setDriveUrl(data.drive_url || '');
                    setDeliveryUrl(data.drive_url || '');
                    setManualCapitulo(data.capitulo ? String(data.capitulo) : '');
                    setManualDriveUrl(data.drive_url || '');
                })
                .catch((err) => {
                    setLoadError(err instanceof Error ? err.message : 'No se pudo cargar la asignacion');
                    console.error(err);
                })
                .finally(() => setLoading(false));
         };

         fetchDetails();

         if (!socket) return;
         const handleContentChanged = () => {
             fetchDetails();
         };
         socket.on('content-changed', handleContentChanged);
         return () => {
             socket.off('content-changed', handleContentChanged);
         };
    }, [id, socket]);

    useEffect(() => {
        if (!isTraductor || viewerDriveLinkType !== 'folder' || !viewerDriveUrl) {
            setDriveImages([]);
            setDriveImagesError('');
            setDriveImagesLoading(false);
            setSelectedImageIndex(0);
            setImageZoom(1);
            return;
        }

        let active = true;
        setDriveImagesLoading(true);
        setDriveImagesError('');
        setSelectedImageIndex(0);
        setImageZoom(1);

        fetch(`/api/drive/folder-images?url=${encodeURIComponent(viewerDriveUrl)}`)
            .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(data?.error || 'No se pudo leer la carpeta de Drive');
                }
                const images = Array.isArray(data?.images) ? data.images : [];
                if (!active) return;
                setDriveImages(images);
                if (images.length === 0) {
                    setDriveImagesError('No se detectaron imagenes en la carpeta.');
                }
            })
            .catch((error: unknown) => {
                if (!active) return;
                setDriveImages([]);
                setDriveImagesError(getErrorMessage(error, 'No se pudo cargar el visor de paginas.'));
            })
            .finally(() => {
                if (active) setDriveImagesLoading(false);
            });

        return () => { active = false; };
    }, [isTraductor, viewerDriveLinkType, viewerDriveUrl]);

    useEffect(() => {
        if (hasCoreRaw && hasEngRaw) {
            if (isTraductor && String(asignacion?.traductor_tipo || '').toUpperCase() === 'ENG') {
                setSelectedRawVariant('ENG');
                return;
            }
            setSelectedRawVariant('CORE');
            return;
        }
        if (hasEngRaw) {
            setSelectedRawVariant('ENG');
            return;
        }
        setSelectedRawVariant('CORE');
    }, [hasCoreRaw, hasEngRaw, isTraductor, asignacion?.traductor_tipo, asignacion?.id]);

    useEffect(() => {
        if (!isTyperInProgress || !asignacion?.proyecto_id) {
            setProjectFontsConfig(DEFAULT_PROJECT_FONTS_CONFIG);
            return;
        }

        let active = true;
        fetch('/api/proyectos')
            .then(async (res) => {
                const data = await res.json().catch(() => []);
                if (!res.ok || !Array.isArray(data)) return null;
                return data.find((item: { id?: number; fuentes_config?: unknown }) => Number(item?.id) === Number(asignacion?.proyecto_id)) || null;
            })
            .then((project) => {
                if (!active) return;
                setProjectFontsConfig(normalizeProjectFontsConfig(project?.fuentes_config));
            })
            .catch(() => {
                if (!active) return;
                setProjectFontsConfig(DEFAULT_PROJECT_FONTS_CONFIG);
            });

        return () => { active = false; };
    }, [isTyperInProgress, asignacion?.proyecto_id]);

    useEffect(() => {
        if (!isTyperInProgress) {
            setAssignmentFontFamilies({});
            return;
        }

        let cancelled = false;
        const loadedFaces: FontFace[] = [];
        if (!assignmentFontsSignature) {
            setAssignmentFontFamilies({});
            return;
        }

        const load = async () => {
            const map: Record<string, string> = {};
            for (const item of assignmentFontsItems) {
                const fileId = String(item.font_file_id || '').trim();
                if (!fileId) continue;
                try {
                    const family = `assignment-font-${item.id}-${fileId.slice(0, 6)}`;
                    const fontFace = new FontFace(family, `url(/api/drive/font?id=${encodeURIComponent(fileId)})`);
                    await fontFace.load();
                    if (cancelled) return;
                    document.fonts.add(fontFace);
                    loadedFaces.push(fontFace);
                    map[item.id] = family;
                } catch {
                    // ignore missing/unreadable font files
                }
            }
            if (!cancelled) setAssignmentFontFamilies(map);
        };

        load();
        return () => {
            cancelled = true;
            loadedFaces.forEach((face) => document.fonts.delete(face));
        };
    }, [isTyperInProgress, assignmentFontsSignature]);

    const loadUsers = async () => {
        try {
            const res = await fetch('/api/usuarios');
            const data = await res.json();
            const list = Array.isArray(data) ? data : [];
            setUsuarios(list.filter((u) => Number(u?.activo ?? 1) === 1));
            setShowReassignModal(true);
        } catch {
            showToast('Error al cargar usuarios', 'error');
        }
    };

    const patchAsignacion = async (payload: Record<string, unknown>) => {
        const res = await fetch(`/api/asignaciones/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo actualizar');
        setAsignacion(data);
        if (typeof data?.drive_url === 'string') {
            setDriveUrl(data.drive_url);
            setDeliveryUrl(data.drive_url);
            setManualDriveUrl(data.drive_url);
        }
        socket?.emit('content-changed');
        return data;
    };

    const handleReassign = async () => {
        if (!selectedUser) return;
        try {
            await patchAsignacion({ usuario_id: parseInt(selectedUser) });
            setShowReassignModal(false);
            showToast('Asignacion reasignada correctamente', 'success');
        } catch (error: unknown) {
            showToast(getErrorMessage(error, 'Error al reasignar'), 'error');
        }
    };

    const updateEstado = async (nuevoEstado: string, deliveryUrlOverride?: string) => {
        try {
            if (nuevoEstado === 'Completado') {
                const finalDeliveryUrl = deliveryUrlOverride ?? (isStaffView ? deliveryUrl : driveUrl);
                if (!isValidDeliveryUrlForRole(asignacion?.rol || '', finalDeliveryUrl)) {
                    showToast('Debes agregar un enlace de entrega valido para este rol antes de terminar.', 'error');
                    return;
                }
                await patchAsignacion({ estado: nuevoEstado, drive_url: normalizeUrlValue(finalDeliveryUrl) });
            } else {
                await patchAsignacion({ estado: nuevoEstado });
            }
            showToast(`Estado actualizado a ${nuevoEstado}`, 'info');
        } catch (error: unknown) {
            showToast(getErrorMessage(error, 'Error al actualizar estado'), 'error');
        }
    };

    const openCompleteFlow = () => {
        const initialUrl = isStaffView ? deliveryUrl : driveUrl;
        setCompletionLink(normalizeUrlValue(initialUrl));
        setShowCompleteConfirmModal(false);
        setShowCompleteFinalModal(false);
        setShowCompleteModal(true);
    };

    const closeCompleteFlow = () => {
        setShowCompleteModal(false);
        setShowCompleteConfirmModal(false);
        setShowCompleteFinalModal(false);
    };

    const continueCompleteFlow = () => {
        if (!isValidDeliveryUrlForRole(asignacion?.rol || '', completionLink)) {
            showToast('Debes agregar un enlace de entrega valido antes de terminar.', 'error');
            return;
        }
        setShowCompleteConfirmModal(true);
    };

    const handleCompleteFlowConfirm = () => {
        setShowCompleteConfirmModal(false);
        setShowCompleteFinalModal(true);
    };

    const submitCompleteFlow = async () => {
        const normalized = normalizeUrlValue(completionLink);
        if (isStaffView) {
            setDeliveryUrl(normalized);
        } else {
            setDriveUrl(normalized);
        }
        await updateEstado('Completado', normalized);
        closeCompleteFlow();
    };

    const submitInforme = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!nuevoInforme.trim()) return;

        try {
            const res = await fetch(`/api/asignaciones/${id}/informes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contenido: nuevoInforme }),
            });
            if (!res.ok) throw new Error('No se pudo guardar el informe');
            setAsignacion(prev => prev ? { ...prev, informe: nuevoInforme } : null);
            setNuevoInforme('');
            showToast('Informe enviado correctamente', 'success');
            socket?.emit('content-changed');
        } catch {
            showToast('Error al enviar informe', 'error');
        }
    };

    const handleDeleteAsignacion = async () => {
        try {
            const res = await fetch(`/api/asignaciones/${id}`, { method: 'DELETE' });
            if (res.ok) {
                showToast('Asignacion eliminada', 'success');
                socket?.emit('content-changed');
                router.push('/asignaciones');
            } else {
                showToast('Error al eliminar asignacion', 'error');
            }
        } finally {
            setShowConfirmModal(false);
        }
    };

    const updateDriveUrl = async () => {
        try {
            await patchAsignacion({ drive_url: driveUrl });
            showToast('Enlace de Drive actualizado', 'success');
        } catch (error: unknown) {
            showToast(getErrorMessage(error, 'Error al actualizar Drive URL'), 'error');
        }
    };

    const updateManualChapter = async () => {
        const capitulo = Number(manualCapitulo);
        if (!Number.isFinite(capitulo) || capitulo <= 0) {
            showToast('Capitulo invalido', 'error');
            return;
        }
        try {
            const payload: Record<string, unknown> = { capitulo };
            const normalized = normalizeUrlValue(manualDriveUrl);
            if (normalized) payload.drive_url = normalized;
            await patchAsignacion(payload);
            showToast('Capitulo actualizado', 'success');
        } catch (error: unknown) {
            showToast(getErrorMessage(error, 'Error al cambiar capitulo'), 'error');
        }
    };

    const resetTiro = async () => {
        try {
            await patchAsignacion({ reset_tiro: true });
            showToast('Tiro reseteado', 'success');
        } catch (error: unknown) {
            showToast(getErrorMessage(error, 'Error al resetear tiro'), 'error');
        }
    };

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center bg-background-dark">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary"></div>
            </div>
        );
    }

    if (!asignacion) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-background-dark text-center p-8">
                <h1 className="text-2xl font-bold text-white mb-2">Asignacion no encontrada</h1>
                {!!loadError && <p className="text-xs text-red-300 mb-2">{loadError}</p>}
                <Link href="/asignaciones" className="text-primary hover:underline">Volver al listado</Link>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto p-4 lg:p-8 bg-background-dark">
            <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <Link href="/asignaciones" className="text-muted-dark hover:text-white text-sm">Volver a la lista</Link>
                        <h1 className="font-display font-bold text-2xl text-white mt-2">{asignacion.descripcion}</h1>
                    </div>
                    {isAdmin && !isStaffView && (
                        <div className="flex gap-2">
                            <button onClick={loadUsers} className="text-primary bg-primary/10 hover:bg-primary/20 p-3 rounded-lg">Reasignar</button>
                            <button onClick={() => setShowConfirmModal(true)} className="text-red-500 bg-red-500/10 hover:bg-red-500/20 p-3 rounded-lg">Eliminar</button>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-surface-dark p-5 rounded-xl border border-gray-800 space-y-3">
                        <p className="text-sm text-gray-300"><strong>Usuario:</strong> {asignacion.usuario_nombre}</p>
                        <p className="text-sm text-gray-300"><strong>Rol:</strong> {asignacion.rol}</p>
                        <p className="text-sm text-gray-300"><strong>Estado:</strong> {asignacion.estado}</p>
                        <p className="text-sm text-gray-300"><strong>Capitulo:</strong> {asignacion.capitulo ?? '-'}</p>
                        <p className="text-sm text-gray-300"><strong>Asignado:</strong> {formatActivityDate(asignacion.asignado_en)}</p>
                        {!isStaffView ? (
                            <div className="space-y-2 pt-2">
                                {['Pendiente', 'En Proceso', 'Completado'].map(status => (
                                    <button
                                        key={status}
                                        onClick={() => status === 'Completado' ? openCompleteFlow() : updateEstado(status)}
                                        className={`w-full py-2 rounded-lg text-sm ${asignacion.estado === status ? 'bg-primary text-white' : 'bg-background-dark text-gray-300'}`}
                                    >
                                        {status}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="space-y-2 pt-2">
                                {asignacion.estado === 'Pendiente' && (
                                    <button
                                        onClick={() => updateEstado('En Proceso')}
                                        className="w-full py-2 rounded-lg text-sm bg-blue-600 text-white"
                                    >
                                        Iniciar
                                    </button>
                                )}
                                {asignacion.estado === 'En Proceso' && (
                                    <button
                                        onClick={openCompleteFlow}
                                        className="w-full py-2 rounded-lg text-sm bg-emerald-600 text-white"
                                    >
                                        Marcar como completado
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="md:col-span-2 space-y-6">
                        <div className="bg-surface-dark p-5 rounded-xl border border-gray-800">
                            <h3 className="text-sm text-white mb-3">
                                {isTraductor ? 'Visualizador de paginas (Drive)' : 'Drive'}
                            </h3>
                            {viewerDriveUrl && (
                                <a
                                    href={viewerDriveUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 mb-3 text-xs bg-blue-500/15 border border-blue-500/30 text-blue-300 px-3 py-2 rounded-lg hover:bg-blue-500/25"
                                >
                                    <span className="material-icons-round text-sm">open_in_new</span>
                                    Ir a Drive
                                </a>
                            )}
                            {canSeeRawControls && (engRawUrl || coreRawUrl) && (
                                <div className="mb-3 space-y-2">
                                    {canToggleRawVariant && hasCoreRaw && hasEngRaw && (
                                        <div className="inline-flex rounded-lg border border-gray-700 bg-background-dark p-1">
                                            <button
                                                type="button"
                                                onClick={() => setSelectedRawVariant('CORE')}
                                                className={`px-3 py-1.5 text-xs rounded ${activeRawVariant === 'CORE' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-gray-300'}`}
                                            >
                                                {`RAW ${coreRawLabel}`}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setSelectedRawVariant('ENG')}
                                                className={`px-3 py-1.5 text-xs rounded ${activeRawVariant === 'ENG' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40' : 'text-gray-300'}`}
                                            >
                                                RAW ENG
                                            </button>
                                        </div>
                                    )}

                                    {canToggleRawVariant ? (
                                        selectedRawUrl && (
                                            <a
                                                href={selectedRawUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-2 text-xs bg-blue-500/15 border border-blue-500/30 text-blue-300 px-3 py-2 rounded-lg hover:bg-blue-500/25"
                                            >
                                                <span className="material-icons-round text-sm">library_books</span>
                                                {`Abrir ${selectedRawLabel}`}
                                            </a>
                                        )
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {engRawUrl && (
                                                <a
                                                    href={engRawUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="inline-flex items-center gap-2 text-xs bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 px-3 py-2 rounded-lg hover:bg-indigo-500/25"
                                                >
                                                    <span className="material-icons-round text-sm">language</span>
                                                    RAW ENG
                                                </a>
                                            )}
                                            {coreRawUrl && (
                                                <a
                                                    href={coreRawUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="inline-flex items-center gap-2 text-xs bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 px-3 py-2 rounded-lg hover:bg-cyan-500/25"
                                                >
                                                    <span className="material-icons-round text-sm">menu_book</span>
                                                    {`RAW ${coreRawLabel}`}
                                                </a>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                            {isTraductor && viewerDriveLinkType === 'folder' && (
                                <div className="mb-4 border border-gray-700 rounded-lg bg-background-dark">
                                    <div className="p-3 border-b border-gray-700 flex flex-wrap gap-2 items-center">
                                        <button
                                            type="button"
                                            onClick={zoomOut}
                                            className="px-3 py-1.5 text-xs rounded border bg-background-dark border-gray-700 text-gray-300"
                                        >
                                            Zoom -
                                        </button>
                                        <button
                                            type="button"
                                            onClick={zoomIn}
                                            className="px-3 py-1.5 text-xs rounded border bg-background-dark border-gray-700 text-gray-300"
                                        >
                                            Zoom +
                                        </button>
                                        <button
                                            type="button"
                                            onClick={resetZoom}
                                            className="px-3 py-1.5 text-xs rounded border bg-background-dark border-gray-700 text-gray-300"
                                        >
                                            Reset
                                        </button>
                                        <button
                                            type="button"
                                            onClick={goPrevImage}
                                            disabled={selectedImageIndex <= 0}
                                            className="px-3 py-1.5 text-xs rounded border bg-background-dark border-gray-700 text-gray-300 disabled:opacity-40"
                                        >
                                            Anterior
                                        </button>
                                        <button
                                            type="button"
                                            onClick={goNextImage}
                                            disabled={selectedImageIndex >= driveImages.length - 1}
                                            className="px-3 py-1.5 text-xs rounded border bg-background-dark border-gray-700 text-gray-300 disabled:opacity-40"
                                        >
                                            Siguiente
                                        </button>
                                        <span className="text-xs text-muted-dark ml-auto">
                                            Zoom {Math.round(imageZoom * 100)}%
                                        </span>
                                    </div>

                                    {driveImagesLoading && (
                                        <div className="p-4 text-sm text-gray-300">Cargando paginas...</div>
                                    )}
                                    {!driveImagesLoading && driveImagesError && (
                                        <div className="p-4 text-sm text-red-300">{driveImagesError}</div>
                                    )}
                                    {!driveImagesLoading && !driveImagesError && selectedImage && (
                                        <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] min-h-[420px]">
                                            <div className="border-r border-gray-700 p-2 max-h-[520px] overflow-y-auto space-y-2">
                                                {driveImages.map((img, idx) => (
                                                    <div
                                                        key={img.id}
                                                        className={`w-full text-left p-2 rounded border ${idx === selectedImageIndex
                                                            ? 'border-primary/60 bg-primary/10'
                                                            : 'border-gray-700 bg-surface-dark'
                                                            }`}
                                                    >
                                                        <p className="text-xs text-white truncate">{img.name}</p>
                                                        <div className="flex items-center justify-between mt-1">
                                                            <p className="text-[10px] text-muted-dark">Pagina {idx + 1}</p>
                                                            <button
                                                                type="button"
                                                                onClick={() => setSelectedImageIndex(idx)}
                                                                className="px-2 py-1 text-[10px] rounded border border-blue-500/40 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"
                                                            >
                                                                Ver
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="p-3 min-w-0">
                                                <div className="w-full h-[500px] overflow-auto rounded border border-gray-700 bg-black/40 flex items-start justify-center">
                                                    <img
                                                        src={`/api/drive/image?id=${selectedImage.id}`}
                                                        alt={selectedImage.name}
                                                        className="block w-full h-auto"
                                                        style={{
                                                            transform: `scale(${imageZoom})`,
                                                            transformOrigin: 'top center',
                                                            marginTop: '8px',
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            {isTraductor && previewUrl && (
                                <div className="mb-4 border border-gray-700 rounded-lg overflow-hidden bg-background-dark">
                                    <iframe
                                        title="Vista previa Drive"
                                        src={previewUrl}
                                        className="w-full h-[420px]"
                                    />
                                </div>
                            )}
                            <div className="mb-4 bg-surface-darker/40 border border-gray-800 rounded-xl">
                                <button
                                    type="button"
                                    onClick={() => setIsSymbolsGuideOpen((prev) => !prev)}
                                    className="w-full px-4 py-3 flex items-center justify-between text-left"
                                >
                                    <div>
                                        <p className="text-sm font-bold text-white uppercase tracking-[0.12em]">Guia de Simbologia</p>
                                        <p className="text-[11px] text-muted-dark mt-1">Estructura base de traduccion para todo el equipo.</p>
                                    </div>
                                    <span className={`material-icons-round text-gray-400 transition-transform ${isSymbolsGuideOpen ? 'rotate-180' : ''}`}>
                                        expand_more
                                    </span>
                                </button>
                                {isSymbolsGuideOpen && (
                                    <div className="px-4 pb-4 border-t border-gray-800/60">
                                        <div className="mt-3 overflow-x-auto rounded-lg border border-gray-700">
                                            <table className="w-full text-sm text-gray-200">
                                                <tbody>
                                                    {[
                                                        { simbolo: '"":', desc: 'Titulos' },
                                                        { simbolo: 'N/T:', desc: 'Notas de traductor' },
                                                        { simbolo: 'Globo X:', desc: 'Texto en globo o dialogos' },
                                                        { simbolo: '():', desc: 'Pensamientos' },
                                                        { simbolo: '*:', desc: 'Fuera de globos' },
                                                        { simbolo: '//:', desc: 'Texto anidado' },
                                                        { simbolo: '[]:', desc: 'Cuadros' },
                                                        { simbolo: '$:', desc: 'Nota pal staff que mire esto / autonota. No me hagan mucho caso.' },
                                                    ].map((item) => (
                                                        <tr key={item.simbolo} className="odd:bg-background-dark even:bg-surface-dark">
                                                            <td className="px-3 py-2 border-r border-gray-700 font-semibold whitespace-nowrap">{item.simbolo}</td>
                                                            <td className="px-3 py-2">{item.desc}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                            {isTyperInProgress && (
                                <div className="mb-4 bg-gradient-to-b from-[#0d1119] to-[#090c12] border border-gray-800 rounded-2xl p-4 md:p-5">
                                    <button
                                        type="button"
                                        onClick={() => setIsTyperGuideOpen((prev) => !prev)}
                                        className="w-full flex items-center justify-between text-left"
                                    >
                                        <h4 className="text-sm md:text-base tracking-[0.18em] uppercase text-white font-bold">
                                            {projectFontsConfig.titulo || 'Guia de Tipografias'}
                                        </h4>
                                        <span className={`material-icons-round text-gray-400 text-base transition-transform ${isTyperGuideOpen ? 'rotate-180' : ''}`}>
                                            expand_more
                                        </span>
                                    </button>

                                    {isTyperGuideOpen && (
                                        <div className="mt-4">
                                            <a
                                                href={projectFontsConfig.fuentes_drive_url || currentDriveUrl || '#'}
                                                target={(projectFontsConfig.fuentes_drive_url || currentDriveUrl) ? '_blank' : undefined}
                                                rel={(projectFontsConfig.fuentes_drive_url || currentDriveUrl) ? 'noreferrer' : undefined}
                                                className={`rounded-xl border p-3 mb-5 flex items-center justify-between gap-3 ${(projectFontsConfig.fuentes_drive_url || currentDriveUrl)
                                                    ? 'border-gray-700 bg-white/[0.02] hover:bg-white/[0.04]'
                                                    : 'border-gray-800 bg-white/[0.01] cursor-not-allowed opacity-70'
                                                    }`}
                                            >
                                                <div className="min-w-0">
                                                    <p className="text-white font-semibold text-sm">Ir al Drive</p>
                                                    <p className="text-[10px] md:text-xs uppercase tracking-[0.12em] text-gray-500">Fuentes</p>
                                                </div>
                                                <span className="material-icons-round text-gray-400">arrow_forward</span>
                                            </a>

                                            <p className="text-[10px] md:text-xs uppercase tracking-[0.16em] text-gray-500 font-semibold mb-3">
                                                Catalogo Visual
                                            </p>

                                            <div className="space-y-3">
                                                {projectFontsConfig.items.map((font) => (
                                                    <div key={font.id} className="rounded-xl border border-gray-800 overflow-hidden">
                                                        <div className="p-3 bg-white/[0.02] flex items-start justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <p className="text-white font-bold text-sm truncate">{font.nombre}</p>
                                                                <p className="text-[10px] md:text-xs text-gray-400 truncate">{font.para}</p>
                                                            </div>
                                                        </div>
                                                        <div className="px-3 py-5 bg-black/35 text-center">
                                                            <p
                                                                className={`text-white text-2xl md:text-3xl font-extrabold leading-none ${font.estilo === 'normal' ? '' : 'italic'}`}
                                                                style={assignmentFontFamilies[font.id] ? { fontFamily: `'${assignmentFontFamilies[font.id]}'` } : undefined}
                                                            >
                                                                {font.ejemplo}
                                                            </p>
                                                            <p className="mt-3 text-[9px] md:text-[10px] uppercase tracking-[0.16em] text-gray-500">
                                                                {font.para || 'Preview'}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            {isTyperOrRedrawer && !currentDriveUrl && (
                                <p className="text-xs text-muted-dark mb-3">
                                    Este rol trabaja directo en Drive, agrega o pega el enlace para abrirlo rapido.
                                </p>
                            )}
                            {isStaffView && isTraductor && (
                                <div className="flex gap-2 mb-3">
                                    {asignacion.estado === 'Pendiente' && (
                                        <button
                                            onClick={() => updateEstado('En Proceso')}
                                            className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-bold"
                                        >
                                            Iniciar
                                        </button>
                                    )}
                                    {asignacion.estado === 'En Proceso' && (
                                        <button
                                            onClick={openCompleteFlow}
                                            className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-bold"
                                        >
                                            Marcar como completado
                                        </button>
                                    )}
                                </div>
                            )}
                            {!isStaffView && (
                                <div className="flex gap-2">
                                    <input
                                        type="url"
                                        value={driveUrl}
                                        onChange={e => setDriveUrl(e.target.value)}
                                        className="flex-1 bg-background-dark border border-gray-700 rounded px-3 py-2 text-white"
                                        placeholder="https://drive.google.com/..."
                                    />
                                    <button onClick={updateDriveUrl} className="bg-primary px-4 py-2 rounded text-white">Guardar</button>
                                </div>
                            )}
                            {isStaffView && (
                                <div className="space-y-2">
                                    <label className="block text-xs text-muted-dark font-bold uppercase tracking-wider">Enlace de entrega</label>
                                    <input
                                        type="url"
                                        value={deliveryUrl}
                                        onChange={(e) => setDeliveryUrl(e.target.value)}
                                        className="w-full bg-background-dark border border-gray-700 rounded px-3 py-2 text-white"
                                        placeholder={getDeliveryPlaceholder(asignacion?.rol || '')}
                                    />
                                    <p className="text-[11px] text-muted-dark">
                                        {isTraductor
                                            ? 'Traductor: pega el enlace del Google Docs final para marcar terminado.'
                                            : 'Typer/Redrawer: pega el enlace de la carpeta de Drive final para marcar terminado.'}
                                    </p>
                                </div>
                            )}
                        </div>

                        {isAdmin && !isStaffView && asignacion.proyecto_id && (
                            <div className="bg-surface-dark p-5 rounded-xl border border-gray-800">
                                <h3 className="text-sm text-white mb-3">Admin: Tiro</h3>
                                <div className="flex gap-2 mb-2">
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={manualCapitulo}
                                        onChange={e => setManualCapitulo(e.target.value)}
                                        className="flex-1 bg-background-dark border border-gray-700 rounded px-3 py-2 text-white"
                                    />
                                </div>
                                <div className="flex gap-2 mb-2">
                                    <input
                                        type="url"
                                        value={manualDriveUrl}
                                        onChange={e => setManualDriveUrl(e.target.value)}
                                        className="flex-1 bg-background-dark border border-gray-700 rounded px-3 py-2 text-white"
                                        placeholder="Enlace de entrega opcional"
                                    />
                                    <button onClick={updateManualChapter} className="bg-blue-500 px-4 py-2 rounded text-white">Guardar cambios</button>
                                </div>
                                <button onClick={resetTiro} className="w-full bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 py-2 rounded">
                                    Resetear tiro
                                </button>
                            </div>
                        )}

                        {!isStaffView && (
                            <div className="bg-surface-dark p-5 rounded-xl border border-gray-800">
                                <h3 className="text-sm text-white mb-3">Informe</h3>
                                <div className="bg-background-dark border border-gray-700 rounded p-3 min-h-[140px] text-gray-300 text-sm mb-3">
                                    {asignacion.informe || 'No hay informe registrado.'}
                            </div>
                            <form onSubmit={submitInforme} className="flex gap-2">
                                <input
                                    type="text"
                                    value={nuevoInforme}
                                    onChange={e => setNuevoInforme(e.target.value)}
                                    className="flex-1 bg-background-dark border border-gray-700 rounded px-3 py-2 text-white"
                                    placeholder="Escribe un informe..."
                                />
                                <button type="submit" className="bg-primary px-4 py-2 rounded text-white">Enviar</button>
                            </form>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {showReassignModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                    <div className="bg-surface-dark rounded-2xl w-full max-w-md border border-gray-800 p-6 space-y-4">
                        <h3 className="font-bold text-white">Reasignar tarea</h3>
                        <select
                            value={selectedUser}
                            onChange={e => setSelectedUser(e.target.value)}
                            className="w-full bg-background-dark border border-gray-700 text-white rounded-lg px-4 py-3"
                        >
                            <option value="">Seleccionar usuario...</option>
                            {usuarios.map(u => (
                                <option key={u.id} value={u.id}>{u.nombre}</option>
                            ))}
                        </select>
                        <div className="flex gap-2">
                            <button onClick={() => setShowReassignModal(false)} className="flex-1 py-2 bg-background-dark rounded text-gray-300">Cancelar</button>
                            <button onClick={handleReassign} disabled={!selectedUser} className="flex-1 py-2 bg-primary rounded text-white disabled:opacity-50">Confirmar</button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={showConfirmModal}
                title="Eliminar Asignacion"
                message="Estas seguro de que quieres eliminar esta asignacion permanentemente?"
                onConfirm={handleDeleteAsignacion}
                onCancel={() => setShowConfirmModal(false)}
                isDanger={true}
                confirmText="Eliminar"
            />

            {showCompleteModal && asignacion && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[55] p-4">
                    <div className="bg-surface-dark rounded-2xl w-full max-w-lg border border-gray-800 shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-800">
                            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-400">Cierre de tarea</p>
                            <h3 className="font-display font-bold text-xl text-white mt-1">Marcar como completado</h3>
                            <p className="text-sm text-gray-300 mt-2">
                                {asignacion.proyecto_titulo || asignacion.descripcion}
                                {asignacion.capitulo ? ` - Capitulo ${asignacion.capitulo}` : ''}
                                {` (${asignacion.rol})`}
                            </p>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs text-muted-dark font-bold uppercase tracking-wider mb-2">Enlace de entrega</label>
                                <input
                                    type="url"
                                    value={completionLink}
                                    onChange={(e) => setCompletionLink(e.target.value)}
                                    className="w-full bg-background-dark border border-gray-700 rounded px-3 py-3 text-white"
                                    placeholder={getDeliveryPlaceholder(asignacion.rol || '')}
                                />
                            </div>
                            <p className="text-[11px] text-muted-dark">
                                {isTraductor
                                    ? 'Traductor: pega el Google Docs o archivo final antes de cerrar.'
                                    : 'Typer/Redrawer: pega la carpeta final de Drive antes de cerrar.'}
                            </p>
                            <p className="text-[12px] text-muted-dark leading-relaxed">
                                Al completar, esta tarea dejara de mostrarse dentro de tus tareas activas.
                            </p>
                        </div>
                        <div className="p-6 pt-0 flex gap-3">
                            <button
                                onClick={closeCompleteFlow}
                                className="flex-1 px-4 py-3 rounded-xl font-bold text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={continueCompleteFlow}
                                className="flex-1 px-4 py-3 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
                            >
                                Continuar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={showCompleteConfirmModal}
                title="Confirmar cierre"
                message="Estas seguro de marcar esta tarea como completada? Ya no se mostrara entre tus tareas activas."
                onConfirm={handleCompleteFlowConfirm}
                onCancel={() => setShowCompleteConfirmModal(false)}
                confirmText="Si, continuar"
            />

            <ConfirmModal
                isOpen={showCompleteFinalModal}
                title="Ultima confirmacion"
                message="Ultima revision: confirma solo si el enlace de entrega ya es el definitivo."
                onConfirm={submitCompleteFlow}
                onCancel={() => setShowCompleteFinalModal(false)}
                confirmText="Completar tarea"
            />
        </div>
    );
}
