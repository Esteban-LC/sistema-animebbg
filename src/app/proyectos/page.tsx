'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useSidebar } from '@/context/SidebarContext';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useSocket } from '@/context/SocketContext';
import { useUser } from '@/context/UserContext';

interface Proyecto {
    id?: number;
    titulo: string;
    tipo: string;
    genero: string;
    capitulos_actuales: number;
    capitulos_totales: number | null;
    capitulos_catalogo: Array<{
        numero: number;
        url: string;
        raw_eng_url?: string;
        traductor_url?: string;
        redraw_url?: string;
        typer_url?: string;
    }>;
    estado: string;
    ultima_actualizacion?: string;
    imagen_url: string;
    frecuencia: string;
    drive_folder_id?: string;
    raw_folder_id?: string;
    raw_eng_folder_id?: string;
    raw_secundario_activo?: number;
    traductor_folder_id?: string;
    redraw_folder_id?: string;
    typer_folder_id?: string;
    fuentes_config?: FuentesConfig | null;
    creditos_config?: CreditosConfig | null;
}

interface FuenteItemConfig {
    id: string;
    nombre: string;
    para: string;
    ejemplo: string;
    estilo?: 'normal' | 'italic';
    font_file_id?: string;
    font_file_name?: string;
}

interface FuentesConfig {
    titulo: string;
    simbolos_url: string;
    fuentes_drive_url: string;
    items: FuenteItemConfig[];
}

interface CreditosConfig {
    defaults: {
        traductor_tag?: string;
        traductor_alias?: string;
        typer_tag?: string;
        typer_alias?: string;
        cleaner_tag?: string;
        cleaner_alias?: string;
    };
    imagen: {
        plantilla_url?: string;
        overlay_url?: string;
        font_file_id?: string;
        font_family?: string;
        font_size?: number | null;
    };
}

interface ProgresoData {
    proyecto: {
        id: number;
        titulo: string;
        capitulos_totales: number | null;
    };
    summary: {
        total_capitulos: number;
        traductor_completados: number;
        typer_completados: number;
        redrawer_completados: number;
        completos_todos_los_roles: number;
    };
    missing: {
        traductor: string[];
        typer: string[];
        redrawer: string[];
    };
    chapters: Array<{
        numero: number;
        label: string;
        traductor: boolean;
        typer: boolean;
        redrawer: boolean;
    }>;
}

const DEFAULT_PROJECT = {
    titulo: '',
    tipo: 'Manga',
    genero: '',
    capitulos_actuales: 0,
    capitulos_totales: null,
    capitulos_catalogo: [],
    estado: 'Activo',
    imagen_url: '',
    frecuencia: 'Mensual',
    drive_folder_id: '',
    raw_folder_id: '',
    raw_eng_folder_id: '',
    raw_secundario_activo: 0,
    traductor_folder_id: '',
    redraw_folder_id: '',
    typer_folder_id: '',
    fuentes_config: null,
    creditos_config: {
        defaults: {
            traductor_tag: '',
            traductor_alias: '',
            typer_tag: '',
            typer_alias: '',
            cleaner_tag: '',
            cleaner_alias: '',
        },
        imagen: {
            plantilla_url: '',
            overlay_url: '',
            font_file_id: '',
            font_family: 'Komika Title',
            font_size: 48,
        },
    },
};

const DEFAULT_FUENTES_CONFIG: FuentesConfig = {
    titulo: 'Guia de Tipografias',
    simbolos_url: '',
    fuentes_drive_url: '',
    items: [
        {
            id: 'wild-words',
            nombre: 'Wild Words',
            para: 'Dialogos principales',
            ejemplo: 'iESTO ES UN DIALOGO!',
            estilo: 'italic',
        },
        {
            id: 'death-killer',
            nombre: 'Death Killer',
            para: 'Onomatopeyas y SFX',
            ejemplo: 'iBOOOM!',
            estilo: 'italic',
        },
        {
            id: 'cc-digital',
            nombre: 'CC Digital Delivery',
            para: 'Pensamientos internos',
            ejemplo: '...',
            estilo: 'normal',
        },
    ],
};

function normalizeChapterCatalog(rawCatalog: unknown[]): Array<{
    numero: number;
    url: string;
    raw_eng_url: string;
    traductor_url: string;
    redraw_url: string;
    typer_url: string;
}> {
    if (!Array.isArray(rawCatalog)) return [];
    const map = new Map<number, {
        numero: number;
        url: string;
        raw_eng_url: string;
        traductor_url: string;
        redraw_url: string;
        typer_url: string;
    }>();

    for (const value of rawCatalog) {
        let numero = NaN;
        let url = '';
        let raw_eng_url = '';
        let traductor_url = '';
        let redraw_url = '';
        let typer_url = '';

        if (typeof value === 'number' || typeof value === 'string') {
            numero = Number(value);
        } else if (value && typeof value === 'object') {
            const item = value as { numero?: unknown; url?: unknown; raw_eng_url?: unknown; traductor_url?: unknown; redraw_url?: unknown; typer_url?: unknown };
            numero = Number(item.numero);
            url = typeof item.url === 'string' ? item.url.trim() : '';
            raw_eng_url = typeof item.raw_eng_url === 'string' ? item.raw_eng_url.trim() : '';
            traductor_url = typeof item.traductor_url === 'string' ? item.traductor_url.trim() : '';
            redraw_url = typeof item.redraw_url === 'string' ? item.redraw_url.trim() : '';
            typer_url = typeof item.typer_url === 'string' ? item.typer_url.trim() : '';
        }

        if (!Number.isFinite(numero) || numero <= 0) continue;
        const existing = map.get(numero);
        if (!existing) {
            map.set(numero, { numero, url, raw_eng_url, traductor_url, redraw_url, typer_url });
            continue;
        }

        map.set(numero, {
            numero,
            url: existing.url || url,
            raw_eng_url: existing.raw_eng_url || raw_eng_url,
            traductor_url: existing.traductor_url || traductor_url,
            redraw_url: existing.redraw_url || redraw_url,
            typer_url: existing.typer_url || typer_url,
        });
    }

    return [...map.values()].sort((a, b) => a.numero - b.numero);
}

function getChapterMax(catalog: Array<{ numero: number; url: string }>): number | null {
    if (!Array.isArray(catalog) || catalog.length === 0) return null;
    return catalog[catalog.length - 1].numero;
}

function getCoreRawLabelByProjectType(tipo: string | undefined) {
    const normalized = String(tipo || '').toLowerCase();
    if (normalized === 'manga') return 'JAP';
    if (normalized === 'manhwa') return 'KO';
    return 'KO/JAP';
}

function normalizeLegacySecondaryRawProject(project: Proyecto): Proyecto {
    return {
        ...project,
        capitulos_catalogo: normalizeChapterCatalog(Array.isArray(project?.capitulos_catalogo) ? project.capitulos_catalogo : []),
        fuentes_config: normalizeFuentesConfig(project?.fuentes_config),
        creditos_config: normalizeCreditosConfig(project?.creditos_config),
    };
}

function toSafeId(input: string, fallback: string) {
    const normalized = String(input || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || fallback;
}

function normalizeTextKey(value: string) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function stripFontExtension(value: string) {
    return String(value || '').replace(/\.(ttf|otf|woff2?|otc)$/i, '').trim();
}

function normalizeFuenteItem(raw: unknown, index: number): FuenteItemConfig {
    const data = (raw && typeof raw === 'object') ? raw as Partial<FuenteItemConfig> : {};
    const legacy = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    const nombre = String(data.nombre || `Fuente ${index + 1}`).trim();
    const ejemplo = String(data.ejemplo || '').trim() || 'Ejemplo';
    const estilo = String(data.estilo || '').toLowerCase() === 'normal' ? 'normal' : 'italic';
    const fallbackPara = String(legacy.uso || legacy.etiqueta || legacy.subtitulo || '').trim();

    return {
        id: toSafeId(String(data.id || nombre), `fuente-${index + 1}`),
        nombre,
        para: String(legacy.para || fallbackPara).trim(),
        ejemplo,
        estilo,
        font_file_id: String(data.font_file_id || '').trim(),
        font_file_name: String(data.font_file_name || '').trim(),
    };
}

function normalizeFuentesConfig(raw: unknown): FuentesConfig {
    const data = (raw && typeof raw === 'object') ? raw as Partial<FuentesConfig> : {};
    const rawItems = Array.isArray(data.items) ? data.items : DEFAULT_FUENTES_CONFIG.items;
    const items = rawItems.map((item, index) => normalizeFuenteItem(item, index));

    return {
        titulo: String(data.titulo || DEFAULT_FUENTES_CONFIG.titulo).trim() || DEFAULT_FUENTES_CONFIG.titulo,
        simbolos_url: String(data.simbolos_url || '').trim(),
        fuentes_drive_url: String(data.fuentes_drive_url || '').trim(),
        items: items.length > 0 ? items : DEFAULT_FUENTES_CONFIG.items.map((item, index) => normalizeFuenteItem(item, index)),
    };
}

function normalizeCreditosConfig(raw: unknown): CreditosConfig {
    const data = (raw && typeof raw === 'object') ? raw as Partial<CreditosConfig> : {};
    const defaults = (data.defaults && typeof data.defaults === 'object') ? data.defaults : {};
    const imagen = (data.imagen && typeof data.imagen === 'object') ? data.imagen : {};
    return {
        defaults: {
            traductor_tag: String(defaults.traductor_tag || '').trim().toLowerCase(),
            traductor_alias: String(defaults.traductor_alias || '').trim(),
            typer_tag: String(defaults.typer_tag || '').trim().toLowerCase(),
            typer_alias: String(defaults.typer_alias || '').trim(),
            cleaner_tag: String(defaults.cleaner_tag || '').trim().toLowerCase(),
            cleaner_alias: String(defaults.cleaner_alias || '').trim(),
        },
        imagen: {
            plantilla_url: String(imagen.plantilla_url || '').trim(),
            overlay_url: String(imagen.overlay_url || '').trim(),
            font_file_id: String(imagen.font_file_id || '').trim(),
            font_family: String(imagen.font_family || 'Komika Title').trim() || 'Komika Title',
            font_size: Number(imagen.font_size || 48) || 48,
        },
    };
}

function hasProjectFuentesConfigured(config: FuentesConfig | null | undefined) {
    if (!config) return false;
    if (String(config.fuentes_drive_url || '').trim()) return true;
    if (String(config.simbolos_url || '').trim()) return true;

    return Array.isArray(config.items) && config.items.some((item) =>
        Boolean(String(item?.font_file_id || '').trim() || String(item?.font_file_name || '').trim())
    );
}

function hasProjectCreditosConfigured(config: CreditosConfig | null | undefined) {
    if (!config) return false;

    const imagen = config.imagen || {};
    const defaults = config.defaults || {};

    return Boolean(
        String(imagen.plantilla_url || '').trim()
        || String(imagen.overlay_url || '').trim()
        || String(imagen.font_file_id || '').trim()
        || String(defaults.traductor_tag || '').trim()
        || String(defaults.traductor_alias || '').trim()
        || String(defaults.typer_tag || '').trim()
        || String(defaults.typer_alias || '').trim()
        || String(defaults.cleaner_tag || '').trim()
        || String(defaults.cleaner_alias || '').trim()
    );
}

export default function ProyectosPage() {
    const { toggle } = useSidebar();
    const { socket } = useSocket();
    const { user } = useUser();
    const [proyectos, setProyectos] = useState<Proyecto[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentProject, setCurrentProject] = useState<Proyecto>(DEFAULT_PROJECT);
    const [isEditing, setIsEditing] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [progressProject, setProgressProject] = useState<Proyecto | null>(null);
    const [progressData, setProgressData] = useState<ProgresoData | null>(null);
    const [progressLoading, setProgressLoading] = useState(false);
    const [chapterInput, setChapterInput] = useState('');
    const [chapterUrlInput, setChapterUrlInput] = useState('');
    const [saveError, setSaveError] = useState('');
    const [savingPlantillaAll, setSavingPlantillaAll] = useState(false);
    const [roleSyncLoading, setRoleSyncLoading] = useState(false);
    const [roleSyncError, setRoleSyncError] = useState('');
    const [roleSyncInfo, setRoleSyncInfo] = useState('');
    const [syncAllLoading, setSyncAllLoading] = useState(false);
    const [syncAllError, setSyncAllError] = useState('');
    const [syncAllInfo, setSyncAllInfo] = useState('');
    const [availableDriveFonts, setAvailableDriveFonts] = useState<Array<{ id: string; name: string; mimeType: string; view_url?: string }>>([]);
    const [driveFontsLoading, setDriveFontsLoading] = useState(false);
    const [driveFontsError, setDriveFontsError] = useState('');
    const [fontPreviewFamilies, setFontPreviewFamilies] = useState<Record<string, string>>({});
    const [savingFuentes, setSavingFuentes] = useState(false);
    const [saveFuentesInfo, setSaveFuentesInfo] = useState('');
    const [saveFuentesError, setSaveFuentesError] = useState('');
    const roles = user?.roles || [];
    const canViewProjectConfigIndicators = Boolean(
        user?.isAdmin
        || roles.includes('Administrador')
        || roles.includes('Lider de Grupo')
    );
    const [modalFocusSection, setModalFocusSection] = useState<'fuentes' | 'creditos' | null>(null);
    const [isFuentesSectionOpen, setIsFuentesSectionOpen] = useState(false);
    const fuentesSectionRef = useRef<HTMLDivElement | null>(null);
    const creditosSectionRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        fetchProyectos();

        // Escuchar evento del BottomNav para abrir modal en mobile
        const handler = () => handleOpenModal();
        const onRealtimeUpdate = (event: Event) => {
            const detail = (event as CustomEvent<{ type?: string; payload?: { project_id?: number; proyecto_id?: number } }>).detail;
            const type = String(detail?.type || '').toLowerCase();
            if (type === 'project' || type === 'assignment' || type === 'notification') {
                fetchProyectos();
            }
        };
        window.addEventListener('open-new-proyecto', handler);
        window.addEventListener('realtime:update', onRealtimeUpdate);
        
        if (!socket) return;
        const handleContentChanged = () => {
             fetchProyectos();
        };
        socket.on('content-changed', handleContentChanged);

        return () => {
            window.removeEventListener('open-new-proyecto', handler);
            window.removeEventListener('realtime:update', onRealtimeUpdate);
            socket.off('content-changed', handleContentChanged);
        };
    }, [socket]);

    const fetchProyectos = async () => {
        try {
            const res = await fetch('/api/proyectos');
            const data = await res.json();
            setProyectos(
                Array.isArray(data)
                    ? data.map((item) => normalizeLegacySecondaryRawProject(item as Proyecto))
                    : []
            );
        } catch (error) {
            console.error(error);
            setProyectos([]);
        } finally {
            setLoading(false);
        }
    };

    const hydrateCatalogFromProject = async (projectId: number) => {
        try {
            const res = await fetch(`/api/proyectos/${projectId}/capitulos`);
            const data = await res.json();
            if (!Array.isArray(data)) return [];
            return normalizeChapterCatalog(
                data.map((item: { numero?: number; url?: string; raw_eng_url?: string; traductor_url?: string; redraw_url?: string; typer_url?: string }) => ({
                    numero: Number(item?.numero),
                    url: typeof item?.url === 'string' ? item.url : '',
                    raw_eng_url: typeof item?.raw_eng_url === 'string' ? item.raw_eng_url : '',
                    traductor_url: typeof item?.traductor_url === 'string' ? item.traductor_url : '',
                    redraw_url: typeof item?.redraw_url === 'string' ? item.redraw_url : '',
                    typer_url: typeof item?.typer_url === 'string' ? item.typer_url : '',
                }))
            );
        } catch {
            return [];
        }
    };

    const handleOpenModal = (proyecto?: Proyecto, focusSection: 'fuentes' | 'creditos' | null = null) => {
        setSaveError('');
        setRoleSyncError('');
        setRoleSyncInfo('');
        setAvailableDriveFonts([]);
        setDriveFontsLoading(false);
        setDriveFontsError('');
        setSaveFuentesInfo('');
        setSaveFuentesError('');
        setModalFocusSection(focusSection);
        setIsFuentesSectionOpen(focusSection === 'fuentes');
        if (proyecto) {
            const initialProject = normalizeLegacySecondaryRawProject({
                ...proyecto,
                capitulos_catalogo: normalizeChapterCatalog(
                    Array.isArray(proyecto.capitulos_catalogo) ? proyecto.capitulos_catalogo : []
                ),
            });
            setCurrentProject(initialProject);
            setIsEditing(true);

            if ((!initialProject.capitulos_catalogo || initialProject.capitulos_catalogo.length === 0) && proyecto.id) {
                hydrateCatalogFromProject(proyecto.id).then((catalogoDetectado) => {
                    if (catalogoDetectado.length === 0) return;
                    setCurrentProject((prev) => {
                        if (Number(prev.id) !== Number(proyecto.id)) return prev;
                        if (prev.capitulos_catalogo && prev.capitulos_catalogo.length > 0) return prev;
                        return {
                            ...prev,
                            capitulos_catalogo: catalogoDetectado,
                            capitulos_totales: getChapterMax(catalogoDetectado) ?? prev.capitulos_totales ?? null,
                        };
                    });
                });
            }
        } else {
            setCurrentProject(DEFAULT_PROJECT);
            setIsEditing(false);
        }
        setChapterInput('');
        setChapterUrlInput('');
        setIsModalOpen(true);
    };

    const calculateProgress = (curr: number, total: number | null) => {
        if (!total) return 100; // Infinite/Unknown
        return Math.min((curr / total) * 100, 100);
    };

    const getRawPublishedMax = (proyecto: Proyecto) => {
        if (Array.isArray(proyecto.capitulos_catalogo) && proyecto.capitulos_catalogo.length > 0) {
            const maxCatalog = getChapterMax(normalizeChapterCatalog(proyecto.capitulos_catalogo));
            if (Number.isFinite(Number(maxCatalog)) && Number(maxCatalog) > 0) {
                return Number(maxCatalog);
            }
        }
        if (Number.isFinite(Number(proyecto.capitulos_totales)) && Number(proyecto.capitulos_totales) > 0) {
            return Number(proyecto.capitulos_totales);
        }
        return null;
    };

    const handleSetPlantillaAll = async (url: string) => {
        if (!url.trim()) return;
        if (!confirm(`¿Aplicar esta URL de plantilla a TODOS los proyectos?\n\n${url}`)) return;
        setSavingPlantillaAll(true);
        setSaveError('');
        try {
            const res = await fetch('/api/proyectos', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set_plantilla_all', plantilla_url: url }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setSaveError(data?.error || 'No se pudo aplicar la plantilla a todos');
                return;
            }
            await fetchProyectos();
        } catch {
            setSaveError('Error de conexion al aplicar plantilla a todos');
        } finally {
            setSavingPlantillaAll(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaveError('');
        setRoleSyncError('');
        setRoleSyncInfo('');
        const url = isEditing ? `/api/proyectos/${currentProject.id}` : '/api/proyectos';
        const method = isEditing ? 'PATCH' : 'POST';
        const sortedCatalog = normalizeChapterCatalog(currentProject.capitulos_catalogo || []);
        const payload = {
            ...currentProject,
            capitulos_catalogo: sortedCatalog,
            capitulos_totales: getChapterMax(sortedCatalog),
            fuentes_config: normalizeFuentesConfig(currentProject.fuentes_config),
            creditos_config: normalizeCreditosConfig(currentProject.creditos_config),
        };

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || 'No se pudo guardar el proyecto');
            }
            setIsModalOpen(false);
            fetchProyectos();
            socket?.emit('content-changed');
        } catch (error) {
            console.error(error);
            setSaveError(error instanceof Error ? error.message : 'No se pudo guardar el proyecto');
        }
    };

    const handleSyncRoleFolders = async () => {
        if (!isEditing || !currentProject.id) {
            setRoleSyncError('Guarda el proyecto primero para poder sincronizar Drive.');
            return;
        }

        const hasAnyFolder = Boolean(
            String(currentProject.raw_folder_id || '').trim()
            || (Number(currentProject.raw_secundario_activo || 0) === 1 && String(currentProject.raw_eng_folder_id || '').trim())
            || String(currentProject.traductor_folder_id || '').trim()
            || String(currentProject.redraw_folder_id || '').trim()
            || String(currentProject.typer_folder_id || '').trim()
        );
        if (!hasAnyFolder) {
            setRoleSyncError('Agrega al menos un enlace/carpeta por rol para sincronizar.');
            return;
        }

        setRoleSyncLoading(true);
        setRoleSyncError('');
        setRoleSyncInfo('');
        try {
            const res = await fetch('/api/admin/drive/set-project-role-folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proyecto_id: currentProject.id,
                    raw: currentProject.raw_folder_id || '',
                    raw_eng: Number(currentProject.raw_secundario_activo || 0) === 1 ? (currentProject.raw_eng_folder_id || '') : '',
                    traduccion: currentProject.traductor_folder_id || '',
                    redraw: currentProject.redraw_folder_id || '',
                    typeo: currentProject.typer_folder_id || '',
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || 'No se pudo sincronizar Drive');
            }

            const catalogoDetectado = await hydrateCatalogFromProject(Number(currentProject.id));
            setCurrentProject((prev) => ({
                ...prev,
                capitulos_catalogo: catalogoDetectado,
                capitulos_totales: getChapterMax(catalogoDetectado) ?? prev.capitulos_totales ?? null,
                raw_folder_id: data?.role_folders?.raw || prev.raw_folder_id || '',
                raw_eng_folder_id: Number(prev.raw_secundario_activo || 0) === 1
                    ? (data?.role_folders?.raw_eng || prev.raw_eng_folder_id || '')
                    : '',
                traductor_folder_id: data?.role_folders?.traductor || prev.traductor_folder_id || '',
                redraw_folder_id: data?.role_folders?.redraw || prev.redraw_folder_id || '',
                typer_folder_id: data?.role_folders?.typer || prev.typer_folder_id || '',
                drive_folder_id: data?.role_folders?.raw || prev.drive_folder_id || '',
            }));
            setRoleSyncInfo(`Sincronizado: ${Number(data?.capitulos_detectados || 0)} capitulos detectados en Drive.`);
            fetchProyectos();
            socket?.emit('content-changed');
        } catch (error) {
            setRoleSyncError(error instanceof Error ? error.message : 'No se pudo sincronizar Drive');
        } finally {
            setRoleSyncLoading(false);
        }
    };

    const handleSyncAllProjects = async () => {
        setSyncAllLoading(true);
        setSyncAllError('');
        setSyncAllInfo('');
        try {
            const res = await fetch('/api/admin/drive/sync-all-projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || 'No se pudo sincronizar todo');
            }

            const summary = data?.summary || {};
            const total = Number(summary.total || 0);
            const ok = Number(summary.sincronizados || 0);
            const omitted = Number(summary.omitidos || 0);
            const errors = Number(summary.errores || 0);
            setSyncAllInfo(`Sincronizacion global completada: ${ok}/${total} ok, ${omitted} omitidos, ${errors} con error.`);
            await fetchProyectos();
            socket?.emit('content-changed');
        } catch (error) {
            setSyncAllError(error instanceof Error ? error.message : 'No se pudo sincronizar todo');
        } finally {
            setSyncAllLoading(false);
        }
    };

    const handleDeleteClick = () => {
        if (!isEditing || !currentProject.id) return;
        setShowConfirmModal(true);
    };

    const handleConfirmDelete = async () => {
        try {
            const res = await fetch(`/api/proyectos/${currentProject.id}`, { method: 'DELETE' });
            if (res.ok) {
                setIsModalOpen(false);
                fetchProyectos();
                socket?.emit('content-changed');
            }
        } catch (error) {
            console.error(error);
        } finally {
            setShowConfirmModal(false);
        }
    };

    const handleOpenProgress = async (proyecto: Proyecto) => {
        if (!proyecto?.id) return;
        setProgressProject(proyecto);
        setProgressData(null);
        setProgressLoading(true);
        try {
            const res = await fetch(`/api/proyectos/${proyecto.id}/progreso`);
            const data = await res.json();
            if (res.ok) {
                setProgressData(data);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setProgressLoading(false);
        }
    };

    const addChapterToProject = () => {
        const value = Number(chapterInput);
        if (!Number.isFinite(value) || value <= 0) return;
        setCurrentProject((prev) => {
            const merged = normalizeChapterCatalog([
                ...(prev.capitulos_catalogo || []),
                {
                    numero: value,
                    url: chapterUrlInput.trim(),
                    raw_eng_url: '',
                },
            ]);
            return {
                ...prev,
                capitulos_catalogo: merged,
                capitulos_totales: getChapterMax(merged),
            };
        });
        setChapterInput('');
        setChapterUrlInput('');
    };

    const removeChapterFromProject = (chapter: number) => {
        setCurrentProject((prev) => {
            const filtered = (prev.capitulos_catalogo || []).filter((c) => Number(c.numero) !== Number(chapter));
            return {
                ...prev,
                capitulos_catalogo: filtered,
                capitulos_totales: getChapterMax(filtered),
            };
        });
    };

    const updateChapterNumber = (oldChapter: number, nextValue: string) => {
        const nextChapter = Number(nextValue);
        if (!Number.isFinite(nextChapter) || nextChapter <= 0) return;

        setCurrentProject((prev) => {
            const updated = normalizeChapterCatalog(
                (prev.capitulos_catalogo || []).map((item) =>
                    Number(item.numero) === Number(oldChapter)
                        ? { ...item, numero: nextChapter }
                        : item
                )
            );

            return {
                ...prev,
                capitulos_catalogo: updated,
                capitulos_totales: getChapterMax(updated),
            };
        });
    };

    const updateChapterUrl = (chapter: number, nextUrl: string) => {
        setCurrentProject((prev) => {
            const updated = normalizeChapterCatalog(
                (prev.capitulos_catalogo || []).map((item) =>
                    Number(item.numero) === Number(chapter)
                        ? { ...item, url: nextUrl }
                        : item
                )
            );

            return {
                ...prev,
                capitulos_catalogo: updated,
                capitulos_totales: getChapterMax(updated),
            };
        });
    };

    const updateChapterRawEngUrl = (chapter: number, nextUrl: string) => {
        setCurrentProject((prev) => {
            const updated = normalizeChapterCatalog(
                (prev.capitulos_catalogo || []).map((item) =>
                    Number(item.numero) === Number(chapter)
                        ? { ...item, raw_eng_url: nextUrl }
                        : item
                )
            );

            return {
                ...prev,
                capitulos_catalogo: updated,
                capitulos_totales: getChapterMax(updated),
            };
        });
    };

    const updateFuentesConfig = (patch: Partial<FuentesConfig>) => {
        setCurrentProject((prev) => ({
            ...prev,
            fuentes_config: {
                ...normalizeFuentesConfig(prev.fuentes_config),
                ...patch,
            },
        }));
    };

    const updateFuenteItem = (id: string, patch: Partial<FuenteItemConfig>) => {
        setCurrentProject((prev) => {
            const config = normalizeFuentesConfig(prev.fuentes_config);
            return {
                ...prev,
                fuentes_config: {
                    ...config,
                    items: config.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
                },
            };
        });
    };

    const loadDriveFonts = async () => {
        const url = String(currentFuentesConfig.fuentes_drive_url || '').trim();
        if (!url) {
            setDriveFontsError('Pega primero el enlace de la carpeta de fuentes.');
            return;
        }

        setDriveFontsLoading(true);
        setDriveFontsError('');
        try {
            const res = await fetch(`/api/drive/folder-fonts?url=${encodeURIComponent(url)}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || 'No se pudieron cargar las fuentes de Drive');
            }
            setAvailableDriveFonts(Array.isArray(data?.fonts) ? data.fonts : []);
            if (!Array.isArray(data?.fonts) || data.fonts.length === 0) {
                setDriveFontsError('No se detectaron archivos de fuentes (.ttf/.otf/.woff/.woff2) en esa carpeta.');
            }
        } catch (error) {
            setAvailableDriveFonts([]);
            setDriveFontsError(error instanceof Error ? error.message : 'No se pudieron cargar las fuentes de Drive');
        } finally {
            setDriveFontsLoading(false);
        }
    };

    const autoAssignFontsByName = () => {
        if (availableDriveFonts.length === 0) {
            setDriveFontsError('Primero carga las fuentes de Drive.');
            return;
        }

        setCurrentProject((prev) => {
            const config = normalizeFuentesConfig(prev.fuentes_config);
            const used = new Set<string>();
            const updatedItems = config.items.map((item) => {
                const targetA = normalizeTextKey(item.nombre);
                const targetB = normalizeTextKey(item.para);
                const match = availableDriveFonts.find((font) => {
                    if (used.has(font.id)) return false;
                    const fontName = normalizeTextKey(font.name.replace(/\.(ttf|otf|woff2?|otc)$/i, ''));
                    const byName = targetA && (fontName.includes(targetA) || targetA.includes(fontName));
                    const bySubtitle = targetB && (fontName.includes(targetB) || targetB.includes(fontName));
                    return byName || bySubtitle;
                });
                if (!match) return item;
                used.add(match.id);
                return {
                    ...item,
                    font_file_id: match.id,
                    font_file_name: match.name,
                };
            });
            return {
                ...prev,
                fuentes_config: {
                    ...config,
                    items: updatedItems,
                },
            };
        });
    };

    const saveFuentesConfigOnly = async () => {
        if (!isEditing || !currentProject.id) {
            setSaveFuentesError('Primero guarda el proyecto para configurar fuentes.');
            return;
        }

        setSavingFuentes(true);
        setSaveFuentesError('');
        setSaveFuentesInfo('');
        try {
            const res = await fetch(`/api/proyectos/${currentProject.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fuentes_config: normalizeFuentesConfig(currentProject.fuentes_config),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'No se pudieron guardar las fuentes');
            setSaveFuentesInfo('Fuentes guardadas correctamente.');
            await fetchProyectos();
        } catch (error) {
            setSaveFuentesError(error instanceof Error ? error.message : 'No se pudieron guardar las fuentes');
        } finally {
            setSavingFuentes(false);
        }
    };

    const addFuenteItem = () => {
        setCurrentProject((prev) => {
            const config = normalizeFuentesConfig(prev.fuentes_config);
            const nextIndex = config.items.length + 1;
            return {
                ...prev,
                fuentes_config: {
                    ...config,
                    items: [
                        ...config.items,
                        {
                            id: `fuente-${nextIndex}`,
                            nombre: `Fuente ${nextIndex}`,
                            para: '',
                            ejemplo: 'Ejemplo',
                            estilo: 'italic',
                        },
                    ],
                },
            };
        });
    };

    const removeFuenteItem = (id: string) => {
        setCurrentProject((prev) => {
            const config = normalizeFuentesConfig(prev.fuentes_config);
            const filtered = config.items.filter((item) => item.id !== id);
            return {
                ...prev,
                fuentes_config: {
                    ...config,
                    items: filtered.length > 0 ? filtered : config.items,
                },
            };
        });
    };

    const rawCatalogSorted = [...(currentProject.capitulos_catalogo || [])].sort((a, b) => b.numero - a.numero);
    const currentRawOfficial = getRawPublishedMax(currentProject);
    const coreRawLabel = getCoreRawLabelByProjectType(currentProject?.tipo);
    const isSecondaryRawEnabled = Number(currentProject?.raw_secundario_activo || 0) === 1;
    const currentFuentesConfig = useMemo(
        () => normalizeFuentesConfig(currentProject.fuentes_config),
        [currentProject.fuentes_config]
    );
    const fuentesItemsForPreview = currentFuentesConfig.items;
    const fuentesPreviewSignature = fuentesItemsForPreview
        .map((item) => `${item.id}:${String(item.font_file_id || '').trim()}`)
        .join('|');

    useEffect(() => {
        if (!isModalOpen) return;

        let cancelled = false;
        const loadedFaces: FontFace[] = [];
        if (!fuentesPreviewSignature) {
            setFontPreviewFamilies({});
            return;
        }

        const load = async () => {
            const map: Record<string, string> = {};
            for (const item of fuentesItemsForPreview) {
                const fileId = String(item.font_file_id || '').trim();
                if (!fileId) continue;
                try {
                    const family = `project-font-${item.id}-${fileId.slice(0, 6)}`;
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
            if (!cancelled) setFontPreviewFamilies(map);
        };

        load();
        return () => {
            cancelled = true;
            loadedFaces.forEach((face) => document.fonts.delete(face));
        };
    }, [isModalOpen, fuentesPreviewSignature]);

    useEffect(() => {
        if (!isModalOpen || !modalFocusSection) return;

        const section = modalFocusSection === 'fuentes'
            ? fuentesSectionRef.current
            : creditosSectionRef.current;

        if (!section) return;

        const timerId = window.setTimeout(() => {
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 120);

        return () => window.clearTimeout(timerId);
    }, [isModalOpen, modalFocusSection]);

    return (
        <div className="flex-1 flex flex-col h-full bg-background-dark overflow-hidden">
            {/* Header - Hidden on mobile because of global navbar, standard on desktop */}
            <header className="h-20 bg-surface-dark border-b border-gray-800 hidden md:flex items-center justify-between px-6 lg:px-8 z-10 sticky top-0 shrink-0">
                <div className="flex items-center gap-4">
                    <h1 className="font-display font-bold text-2xl lg:text-3xl uppercase tracking-wider text-white">
                        <span className="text-primary">Proyectos</span>
                    </h1>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleSyncAllProjects}
                        disabled={syncAllLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-bold shadow-lg shadow-blue-500/20 transition-all"
                    >
                        <span className="material-icons-round text-base">sync</span>
                        <span>{syncAllLoading ? 'Sincronizando...' : 'Sincronizar Todo'}</span>
                    </button>
                    <button
                        onClick={() => handleOpenModal()}
                        className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-bold shadow-lg shadow-primary/30 transition-all transform hover:scale-105"
                    >
                        <span className="material-icons-round text-base">add</span>
                        <span>Nuevo Proyecto</span>
                    </button>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 lg:p-8 pb-32 md:pb-8">
                <div className="max-w-[1600px] mx-auto">
                    {(syncAllError || syncAllInfo) && (
                        <div className={`mb-4 p-3 rounded-lg border text-sm ${syncAllError ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
                            {syncAllError || syncAllInfo}
                        </div>
                    )}
                    {loading ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-6">
                            {[...Array(10)].map((_, i) => (
                                <div key={i} className="bg-surface-dark rounded-xl overflow-hidden shadow-lg border border-gray-800 h-full relative animate-pulse">
                                    <div className="aspect-[2/3] bg-gray-800/50"></div>
                                    <div className="p-4 space-y-3">
                                        <div className="h-4 bg-gray-800/50 rounded w-3/4"></div>
                                        <div className="h-3 bg-gray-800/50 rounded w-1/2"></div>
                                        <div className="space-y-2 pt-2">
                                            <div className="flex justify-between">
                                                <div className="h-3 bg-gray-800/50 rounded w-1/4"></div>
                                                <div className="h-3 bg-gray-800/50 rounded w-1/4"></div>
                                            </div>
                                            <div className="h-1.5 bg-gray-800/50 rounded-full w-full"></div>
                                        </div>
                                        <div className="h-8 bg-gray-800/50 rounded w-full mt-4"></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-6">
                            {proyectos.map(p => (
                                <div key={p.id} className="bg-surface-dark rounded-xl overflow-hidden shadow-card hover:shadow-card-hover border border-gray-800 hover:border-primary/50 transition-all duration-300 group flex flex-col h-full relative animate-scale-in">
                                    <div className="relative aspect-[3/4] sm:aspect-[2/3] overflow-hidden bg-gradient-to-br from-gray-900 to-gray-800">
                                        <img
                                            alt={p.titulo}
                                            className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-500"
                                            src={p.imagen_url || 'https://via.placeholder.com/300x450?text=No+Cover'}
                                            loading="lazy"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-90 group-hover:opacity-95 transition-opacity"></div>

                                        {/* Status Badge with Glow */}
                                        <div className="absolute top-3 right-3">
                                            <span className={`text-white text-[10px] font-bold px-3 py-1.5 rounded-lg uppercase tracking-wider backdrop-blur-md shadow-glow flex items-center gap-1.5 ${p.estado === 'Activo' ? 'bg-emerald-500/90 shadow-emerald-500/50' :
                                                p.estado === 'Pausado' ? 'bg-yellow-500/90 shadow-yellow-500/50' :
                                                    p.estado === 'Finalizado' ? 'bg-red-500/90 shadow-red-500/50' :
                                                        p.estado === 'Cancelado' ? 'bg-gray-500/90 shadow-gray-500/50' :
                                                            'bg-primary/90 shadow-primary/50'
                                                }`}>
                                                <span className="material-icons-round text-xs">
                                                    {p.estado === 'Activo' ? 'play_circle' :
                                                        p.estado === 'Pausado' ? 'pause_circle' :
                                                            p.estado === 'Finalizado' ? 'check_circle' :
                                                                p.estado === 'Cancelado' ? 'cancel' :
                                                                    'help'}
                                                </span>
                                                {p.estado}
                                            </span>
                                        </div>

                                        {/* Title Overlay */}
                                        <div className="absolute bottom-0 left-0 w-full p-4 bg-gradient-to-t from-black/80 to-transparent">
                                            <h3 className="text-lg sm:text-xl font-display font-bold text-white leading-tight mb-1.5 group-hover:text-primary transition-colors line-clamp-2 drop-shadow-lg">{p.titulo}</h3>
                                            <div className="flex items-center gap-2 text-xs text-gray-300 font-medium">
                                                <span className="px-2 py-0.5 bg-white/10 backdrop-blur-sm rounded">{p.tipo}</span>
                                                <span>•</span>
                                                <span>{p.genero}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Card Content */}
                                    <div className="p-3 sm:p-4 flex-1 flex flex-col justify-between bg-gradient-to-b from-surface-dark to-surface-darker">
                                        <div className="space-y-3">
                                            <div className="flex items-end justify-between mb-2">
                                                <div>
                                                    <span className="text-[10px] uppercase font-bold text-muted-dark tracking-wider block mb-0.5">Realizados</span>
                                                    <span className="text-xl font-display font-bold text-white leading-none">{p.capitulos_actuales}</span>
                                                </div>
                                                <div className="text-right">
                                                    <span className="text-[10px] uppercase font-bold text-muted-dark tracking-wider block mb-0.5">Raw</span>
                                                    <span className="text-xl font-display font-bold text-gray-400 leading-none">{getRawPublishedMax(p) || '?'}</span>
                                                </div>
                                            </div>

                                            {canViewProjectConfigIndicators && (
                                                <div className="grid grid-cols-1 gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenModal(p, 'fuentes')}
                                                        className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 transition-colors hover:border-primary/60 ${hasProjectFuentesConfigured(p.fuentes_config)
                                                        ? 'border-emerald-500/30 bg-emerald-500/10'
                                                        : 'border-red-500/30 bg-red-500/10'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className={`material-icons-round text-base ${hasProjectFuentesConfigured(p.fuentes_config) ? 'text-emerald-300' : 'text-red-300'}`}>
                                                                {hasProjectFuentesConfigured(p.fuentes_config) ? 'check_circle' : 'cancel'}
                                                            </span>
                                                            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-200">Fuentes</span>
                                                        </div>
                                                        <span className={`text-[10px] font-bold uppercase tracking-wider ${hasProjectFuentesConfigured(p.fuentes_config) ? 'text-emerald-200' : 'text-red-200'}`}>
                                                            {hasProjectFuentesConfigured(p.fuentes_config) ? 'Asignadas' : 'Pendiente'}
                                                        </span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenModal(p, 'creditos')}
                                                        className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 transition-colors hover:border-primary/60 ${hasProjectCreditosConfigured(p.creditos_config)
                                                        ? 'border-emerald-500/30 bg-emerald-500/10'
                                                        : 'border-red-500/30 bg-red-500/10'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className={`material-icons-round text-base ${hasProjectCreditosConfigured(p.creditos_config) ? 'text-emerald-300' : 'text-red-300'}`}>
                                                                {hasProjectCreditosConfigured(p.creditos_config) ? 'check_circle' : 'cancel'}
                                                            </span>
                                                            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-200">Plantilla creditos</span>
                                                        </div>
                                                        <span className={`text-[10px] font-bold uppercase tracking-wider ${hasProjectCreditosConfigured(p.creditos_config) ? 'text-emerald-200' : 'text-red-200'}`}>
                                                            {hasProjectCreditosConfigured(p.creditos_config) ? 'Asignada' : 'Pendiente'}
                                                        </span>
                                                    </button>
                                                </div>
                                            )}

                                            {/* Progress Bar with Glow */}
                                            <div className="relative">
                                                <div className="w-full bg-surface-darker rounded-full h-1.5 overflow-hidden shadow-inner">
                                                    <div
                                                        className={`h-full rounded-full transition-all duration-500 relative ${p.estado === 'Activo' ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' :
                                                            p.estado === 'Pausado' ? 'bg-gradient-to-r from-yellow-500 to-yellow-400' :
                                                                p.estado === 'Finalizado' ? 'bg-gradient-to-r from-red-500 to-red-400' :
                                                                p.estado === 'Cancelado' ? 'bg-gradient-to-r from-gray-500 to-gray-400' :
                                                                    'bg-gradient-to-r from-primary to-blue-400'
                                                            }`}
                                                        style={{ width: `${calculateProgress(p.capitulos_actuales, getRawPublishedMax(p))}%` }}
                                                    >
                                                        <div className="absolute inset-0 bg-white/20 animate-glow-pulse"></div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <button
                                                onClick={() => handleOpenProgress(p)}
                                                className="w-full py-2 bg-surface-darker hover:bg-blue-500/20 hover:text-white text-gray-300 border border-gray-700 hover:border-blue-400 rounded-lg text-[11px] sm:text-sm font-bold transition-all duration-300 flex items-center justify-center gap-1.5 sm:gap-2"
                                            >
                                                <span className="material-icons-round text-lg">insights</span>
                                                Progreso
                                            </button>
                                            <button
                                                onClick={() => handleOpenModal(p)}
                                                className="w-full py-2 bg-surface-darker hover:bg-primary hover:text-white text-gray-300 border border-gray-700 hover:border-primary rounded-lg text-[11px] sm:text-sm font-bold transition-all duration-300 flex items-center justify-center gap-1.5 sm:gap-2 hover:shadow-glow hover:shadow-primary/30 hover:scale-105 active:scale-100"
                                            >
                                                <span className="material-icons-round text-lg">settings</span>
                                                Gestionar
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* Add New Card */}
                            <div
                                onClick={() => handleOpenModal()}
                                className="bg-surface-darker rounded-xl border-2 border-dashed border-gray-700 hover:border-primary/50 hover:bg-surface-dark transition-all group flex flex-col h-full min-h-[220px] sm:min-h-[300px] cursor-pointer items-center justify-center"
                            >
                                <div className="p-8 text-center">
                                    <div className="w-16 h-16 rounded-full bg-surface-dark flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                                        <span className="material-icons-round text-3xl text-gray-400 group-hover:text-primary transition-colors">add</span>
                                    </div>
                                    <h3 className="text-lg font-bold text-white mb-1">Nuevo Proyecto</h3>
                                    <p className="text-xs text-muted-dark">Añadir una nueva serie al catálogo</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* FAB eliminado - el botón + está integrado en el BottomNav */}

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm">
                    <div className="bg-surface-dark w-full max-w-3xl max-h-[92vh] rounded-2xl border border-gray-800 shadow-2xl overflow-hidden animate-fade-in">
                        <div className="bg-surface-darker p-4 border-b border-gray-800 flex justify-between items-center">
                            <h3 className="font-display font-bold text-xl text-white">
                                {isEditing ? 'Editar Proyecto' : 'Nuevo Proyecto'}
                            </h3>
                            <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-white">
                                <span className="material-icons-round">close</span>
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 max-h-[calc(92vh-72px)] overflow-y-auto">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Título</label>
                                    <input
                                        type="text"
                                        value={currentProject.titulo}
                                        onChange={e => setCurrentProject({ ...currentProject, titulo: e.target.value })}
                                        className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Tipo</label>
                                    <select
                                        value={currentProject.tipo}
                                        onChange={e => setCurrentProject({ ...currentProject, tipo: e.target.value })}
                                        className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                                    >
                                        <option>Manhwa</option>
                                        <option>Manga</option>
                                        <option>Manhua</option>
                                        <option>Cómic</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Género</label>
                                    <input
                                        type="text"
                                        value={currentProject.genero}
                                        onChange={e => setCurrentProject({ ...currentProject, genero: e.target.value })}
                                        className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                                        placeholder="Acción, Aventura..."
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Realizados</label>
                                    <input
                                        type="number"
                                        value={currentProject.capitulos_actuales}
                                        readOnly
                                        className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-2 text-gray-400 cursor-not-allowed"
                                    />
                                    <p className="text-[11px] text-muted-dark mt-1">Se calcula autom&aacute;ticamente seg&uacute;n el &uacute;ltimo cap&iacute;tulo completado.</p>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Carpetas Drive por Rol</label>
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <p className="text-[11px] text-muted-dark">
                                            {isSecondaryRawEnabled
                                                ? `Par de RAW activo: RAW ENG - RAW ${coreRawLabel}`
                                                : `RAW adicional desactivado (solo RAW ${coreRawLabel})`}
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => setCurrentProject((prev) => ({
                                                ...prev,
                                                raw_secundario_activo: Number(prev.raw_secundario_activo || 0) === 1 ? 0 : 1,
                                                raw_eng_folder_id: Number(prev.raw_secundario_activo || 0) === 1 ? '' : (prev.raw_eng_folder_id || ''),
                                            }))}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${isSecondaryRawEnabled
                                                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                                                : 'bg-gray-700/20 border-gray-600 text-gray-300'
                                                }`}
                                        >
                                            {isSecondaryRawEnabled ? 'RAW adicional: SI aplica' : 'RAW adicional: NO aplica'}
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {isSecondaryRawEnabled && (
                                        <input
                                            type="text"
                                            value={currentProject.raw_eng_folder_id || ''}
                                            onChange={e => setCurrentProject({ ...currentProject, raw_eng_folder_id: e.target.value })}
                                            className="bg-background-dark border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                                            placeholder={`RAW ${coreRawLabel}: link de carpeta o ID`}
                                        />
                                    )}
                                    <input
                                        type="text"
                                        value={currentProject.raw_folder_id || ''}
                                        onChange={e => setCurrentProject({ ...currentProject, raw_folder_id: e.target.value })}
                                        className="bg-background-dark border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                                        placeholder="RAW ENG: link de carpeta o ID"
                                    />
                                        <input
                                            type="text"
                                            value={currentProject.traductor_folder_id || ''}
                                            onChange={e => setCurrentProject({ ...currentProject, traductor_folder_id: e.target.value })}
                                            className="bg-background-dark border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                                            placeholder="Traduccion: link de carpeta o ID"
                                        />
                                        <input
                                            type="text"
                                            value={currentProject.redraw_folder_id || ''}
                                            onChange={e => setCurrentProject({ ...currentProject, redraw_folder_id: e.target.value })}
                                            className="bg-background-dark border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                                            placeholder="Redraw: link de carpeta o ID"
                                        />
                                        <input
                                            type="text"
                                            value={currentProject.typer_folder_id || ''}
                                            onChange={e => setCurrentProject({ ...currentProject, typer_folder_id: e.target.value })}
                                            className="bg-background-dark border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                                            placeholder="Typeo: link de carpeta o ID"
                                        />
                                    </div>
                                    <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
                                        <button
                                            type="button"
                                            onClick={handleSyncRoleFolders}
                                            disabled={!isEditing || roleSyncLoading}
                                            className="w-full sm:w-auto px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold"
                                        >
                                            {roleSyncLoading ? 'Sincronizando...' : 'Autorrellenar capitulos desde Drive'}
                                        </button>
                                        <p className="text-[11px] text-muted-dark">
                                            {isSecondaryRawEnabled
                                                ? `Usa estas carpetas para detectar automaticamente RAW ENG y RAW ${coreRawLabel}, ademas de Traduccion, Redraw y Typeo.`
                                                : `Usa estas carpetas para detectar RAW ${coreRawLabel}, Traduccion, Redraw y Typeo.`}
                                        </p>
                                    </div>
                                    {roleSyncError && (
                                        <p className="mt-2 text-xs text-red-300">{roleSyncError}</p>
                                    )}
                                    {roleSyncInfo && (
                                        <p className="mt-2 text-xs text-emerald-300">{roleSyncInfo}</p>
                                    )}
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Raw</label>
                                    <p className="text-[11px] text-muted-dark mt-1">
                                        Capitulo total oficial: {currentRawOfficial ?? '-'}
                                    </p>
                                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={chapterInput}
                                            onChange={e => setChapterInput(e.target.value)}
                                            className="bg-background-dark border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                                            placeholder="Agregar capitulo (ej. 7.2)"
                                        />
                                        <input
                                            type="url"
                                            value={chapterUrlInput}
                                            onChange={e => setChapterUrlInput(e.target.value)}
                                            className="bg-background-dark border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                                            placeholder="Raw (Drive) opcional"
                                        />
                                    </div>
                                    <div className="mt-2 flex">
                                        <button
                                            type="button"
                                            onClick={addChapterToProject}
                                            className="w-full sm:w-auto px-3 py-2 rounded-lg bg-primary hover:bg-primary-dark text-white text-xs font-bold"
                                        >
                                            Anadir
                                        </button>
                                    </div>
                                    <div className="mt-3">
                                        <div className="w-full">
                                            <p className="text-sm font-bold text-white mb-2">
                                                Hasta capitulo {currentRawOfficial ?? '-'}
                                            </p>
                                            <div className="max-h-72 overflow-y-auto grid grid-cols-1 gap-2">
                                                {rawCatalogSorted.map((cap) => (
                                                    <div
                                                        key={cap.numero}
                                                        className="bg-surface-darker border border-gray-700 rounded-lg px-3 py-2.5"
                                                    >
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <div className="w-9 h-9 rounded bg-background-dark border border-gray-700 flex items-center justify-center">
                                                                <span className="material-icons-round text-[18px] text-gray-300">menu_book</span>
                                                            </div>
                                                            <span className="text-base text-gray-100">Capitulo</span>
                                                        </div>
                                                        <div className={`grid grid-cols-1 ${isSecondaryRawEnabled ? 'sm:grid-cols-[1fr_2fr_2fr_auto]' : 'sm:grid-cols-[1fr_2fr_auto]'} gap-2`}>
                                                            <input
                                                                type="number"
                                                                step="0.1"
                                                                value={cap.numero}
                                                                onChange={(e) => updateChapterNumber(cap.numero, e.target.value)}
                                                                className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                                                            />
                                                                <input
                                                                    type="url"
                                                                    value={cap.url || ''}
                                                                    onChange={(e) => updateChapterUrl(cap.numero, e.target.value)}
                                                                    className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                                                                    placeholder="Raw ENG https://drive.google.com/..."
                                                                />
                                                                {isSecondaryRawEnabled && (
                                                                    <input
                                                                        type="url"
                                                                        value={cap.raw_eng_url || ''}
                                                                        onChange={(e) => updateChapterRawEngUrl(cap.numero, e.target.value)}
                                                                        className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                                                                        placeholder={`Raw ${coreRawLabel} https://drive.google.com/...`}
                                                                    />
                                                                )}
                                                            <button
                                                                type="button"
                                                                onClick={() => removeChapterFromProject(cap.numero)}
                                                                className="px-3 py-1.5 rounded bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-bold hover:bg-red-500/20"
                                                            >
                                                                Quitar
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                                {rawCatalogSorted.length === 0 && (
                                                    <div className="col-span-full text-xs text-muted-dark border border-dashed border-gray-700 rounded-lg p-3">
                                                        Aun no hay capitulos en el RAW.
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <p className="text-[11px] text-muted-dark mt-1">Selecciona o agrega capitulos concretos para asignaciones.</p>
                                </div>
                                <div
                                    ref={fuentesSectionRef}
                                    className={`md:col-span-2 scroll-mt-6 rounded-xl ${modalFocusSection === 'fuentes' ? 'ring-1 ring-primary/40' : ''}`}
                                >
                                    <details open={isFuentesSectionOpen} className="group rounded-xl border border-gray-800 bg-surface-darker/40">
                                        <summary
                                            className="list-none cursor-pointer px-4 py-3 flex items-center justify-between"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                setIsFuentesSectionOpen((prev) => !prev);
                                                setModalFocusSection('fuentes');
                                            }}
                                        >
                                            <div>
                                                <p className="text-xs font-bold text-muted-dark uppercase tracking-wider">Fuentes por Proyecto</p>
                                                <p className="text-[11px] text-muted-dark mt-1">Configura enlaces y ejemplos visuales para Typer.</p>
                                            </div>
                                            <span className="material-icons-round text-gray-400 group-open:rotate-180 transition-transform">expand_more</span>
                                        </summary>
                                        <div className="px-4 pb-4 space-y-3 border-t border-gray-800/60">
                                            <input
                                                type="text"
                                                value={currentFuentesConfig.titulo}
                                                onChange={(e) => updateFuentesConfig({ titulo: e.target.value })}
                                                className="w-full mt-3 bg-background-dark border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                                                placeholder="Titulo de la guia"
                                            />
                                            <div className="grid grid-cols-1 gap-2">
                                                <input
                                                    type="url"
                                                    value={currentFuentesConfig.fuentes_drive_url}
                                                    onChange={(e) => updateFuentesConfig({ fuentes_drive_url: e.target.value })}
                                                    className="bg-background-dark border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                                                    placeholder="URL Drive de fuentes"
                                                />
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    onClick={loadDriveFonts}
                                                    disabled={driveFontsLoading}
                                                    className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-bold"
                                                >
                                                    {driveFontsLoading ? 'Cargando fuentes...' : 'Cargar fuentes de Drive'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={autoAssignFontsByName}
                                                    disabled={availableDriveFonts.length === 0}
                                                    className="px-3 py-2 rounded-lg bg-primary/20 border border-primary/40 text-primary text-xs font-bold disabled:opacity-50"
                                                >
                                                    Autovincular por nombre
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={saveFuentesConfigOnly}
                                                    disabled={!isEditing || !currentProject.id || savingFuentes}
                                                    className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-bold"
                                                >
                                                    {savingFuentes ? 'Guardando fuentes...' : 'Guardar fuentes'}
                                                </button>
                                            </div>
                                            {driveFontsError && <p className="text-xs text-red-300">{driveFontsError}</p>}
                                            {saveFuentesError && <p className="text-xs text-red-300">{saveFuentesError}</p>}
                                            {saveFuentesInfo && <p className="text-xs text-emerald-300">{saveFuentesInfo}</p>}
                                            {availableDriveFonts.length > 0 && (
                                                <div className="rounded-lg border border-gray-700 bg-background-dark/60 p-2 max-h-44 overflow-y-auto">
                                                    <p className="text-[11px] text-muted-dark mb-2 uppercase tracking-wider">Archivos detectados</p>
                                                    <div className="space-y-1.5">
                                                        {availableDriveFonts.map((font) => (
                                                            <div key={font.id} className="text-xs text-gray-300 px-2 py-1 rounded bg-surface-dark border border-gray-800 truncate">
                                                                {font.name}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="space-y-3">
                                                {currentFuentesConfig.items.map((item) => (
                                                    <div key={item.id} className="rounded-lg border border-gray-700 p-3 bg-background-dark/60 space-y-2">
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                            <div className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-gray-300">
                                                                {item.font_file_name ? stripFontExtension(item.font_file_name) : (item.nombre || 'Fuente sin seleccionar')}
                                                            </div>
                                                            <input
                                                                type="text"
                                                                value={item.para}
                                                                onChange={(e) => updateFuenteItem(item.id, { para: e.target.value })}
                                                                className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                                                                placeholder="Para (ej: Dialogos principales)"
                                                            />
                                                        </div>
                                                        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-2">
                                                            <select
                                                                value={String(item.font_file_id || '')}
                                                                onChange={(e) => {
                                                                    const selectedId = e.target.value;
                                                                    const selected = availableDriveFonts.find((font) => font.id === selectedId);
                                                                    updateFuenteItem(item.id, {
                                                                        font_file_id: selectedId,
                                                                        font_file_name: selected?.name || '',
                                                                        nombre: selected?.name ? stripFontExtension(selected.name) : item.nombre,
                                                                    });
                                                                }}
                                                                className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                                                            >
                                                                <option value="">Fuente real (opcional)</option>
                                                                {availableDriveFonts.map((font) => (
                                                                    <option key={font.id} value={font.id}>{font.name}</option>
                                                                ))}
                                                            </select>
                                                            {item.font_file_name && (
                                                                <span className="px-3 py-2 text-xs rounded-lg bg-surface-dark border border-gray-700 text-gray-300 truncate max-w-64">
                                                                    {item.font_file_name}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <input
                                                                type="text"
                                                                value={item.ejemplo}
                                                                onChange={(e) => updateFuenteItem(item.id, { ejemplo: e.target.value })}
                                                                className="flex-1 bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                                                                placeholder="Texto de ejemplo"
                                                            />
                                                            <select
                                                                value={item.estilo || 'italic'}
                                                                onChange={(e) => updateFuenteItem(item.id, { estilo: e.target.value === 'normal' ? 'normal' : 'italic' })}
                                                                className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                                                            >
                                                                <option value="italic">Italic</option>
                                                                <option value="normal">Normal</option>
                                                            </select>
                                                            <button
                                                                type="button"
                                                                onClick={() => removeFuenteItem(item.id)}
                                                                className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-bold hover:bg-red-500/20"
                                                            >
                                                                Quitar
                                                            </button>
                                                        </div>
                                                        <div className="rounded-lg border border-gray-800 bg-black/30 p-3 text-center">
                                                            <p
                                                                className={`text-2xl font-extrabold ${item.estilo === 'normal' ? '' : 'italic'} text-white`}
                                                                style={fontPreviewFamilies[item.id] ? { fontFamily: `'${fontPreviewFamilies[item.id]}'` } : undefined}
                                                            >
                                                                {item.ejemplo || 'Ejemplo'}
                                                            </p>
                                                            <p className="text-[10px] uppercase tracking-[0.12em] text-gray-500 mt-2">{item.para || 'Preview'}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={addFuenteItem}
                                                className="px-3 py-2 rounded-lg bg-primary/20 border border-primary/40 text-primary text-xs font-bold hover:bg-primary/30"
                                            >
                                                Agregar fuente
                                            </button>
                                        </div>
                                    </details>
                                </div>
                                <div
                                    ref={creditosSectionRef}
                                    className={`md:col-span-2 scroll-mt-6 rounded-xl ${modalFocusSection === 'creditos' ? 'ring-1 ring-primary/40' : ''}`}
                                >
                                    <div className="rounded-xl border border-gray-700 bg-background-dark/60 p-4 space-y-3">
                                        <h4 className="text-sm font-bold text-white uppercase tracking-wider">Plantilla Creditos (Solo Imagen)</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            <div className="flex gap-1">
                                                <input
                                                    type="text"
                                                    value={currentProject.creditos_config?.imagen?.plantilla_url || ''}
                                                    onChange={(e) => setCurrentProject((prev) => ({
                                                        ...prev,
                                                        creditos_config: normalizeCreditosConfig({
                                                            ...prev.creditos_config,
                                                            imagen: {
                                                                ...prev.creditos_config?.imagen,
                                                                plantilla_url: e.target.value,
                                                            },
                                                        }),
                                                    }))}
                                                    className="flex-1 bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                                                    placeholder="URL plantilla base"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => handleSetPlantillaAll(currentProject.creditos_config?.imagen?.plantilla_url || '')}
                                                    disabled={savingPlantillaAll || !currentProject.creditos_config?.imagen?.plantilla_url}
                                                    className="px-2 py-1 rounded-lg bg-purple-700 hover:bg-purple-800 text-white text-[11px] font-bold disabled:opacity-40 shrink-0"
                                                    title="Aplicar esta URL a todos los proyectos"
                                                >
                                                    Todos
                                                </button>
                                            </div>
                                            <input
                                                type="text"
                                                value={currentProject.creditos_config?.imagen?.overlay_url || ''}
                                                onChange={(e) => setCurrentProject((prev) => ({
                                                    ...prev,
                                                    creditos_config: normalizeCreditosConfig({
                                                        ...prev.creditos_config,
                                                        imagen: {
                                                            ...prev.creditos_config?.imagen,
                                                            overlay_url: e.target.value,
                                                        },
                                                    }),
                                                }))}
                                                className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                                                placeholder="URL overlay (opcional)"
                                            />
                                            <input
                                                type="text"
                                                value={currentProject.creditos_config?.imagen?.font_file_id || ''}
                                                onChange={(e) => setCurrentProject((prev) => ({
                                                    ...prev,
                                                    creditos_config: normalizeCreditosConfig({
                                                        ...prev.creditos_config,
                                                        imagen: {
                                                            ...prev.creditos_config?.imagen,
                                                            font_file_id: e.target.value,
                                                        },
                                                    }),
                                                }))}
                                                className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                                                placeholder="ID o URL de fuente (Drive)"
                                            />
                                            <input
                                                type="text"
                                                value={currentProject.creditos_config?.imagen?.font_family || 'Komika Title'}
                                                onChange={(e) => setCurrentProject((prev) => ({
                                                    ...prev,
                                                    creditos_config: normalizeCreditosConfig({
                                                        ...prev.creditos_config,
                                                        imagen: {
                                                            ...prev.creditos_config?.imagen,
                                                            font_family: e.target.value,
                                                        },
                                                    }),
                                                }))}
                                                className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                                                placeholder="Fuente (ej: Komika Title)"
                                            />
                                            <input
                                                type="number"
                                                min={1}
                                                value={Number(currentProject.creditos_config?.imagen?.font_size || 48)}
                                                onChange={(e) => setCurrentProject((prev) => ({
                                                    ...prev,
                                                    creditos_config: normalizeCreditosConfig({
                                                        ...prev.creditos_config,
                                                        imagen: {
                                                            ...prev.creditos_config?.imagen,
                                                            font_size: Number(e.target.value || 48),
                                                        },
                                                    }),
                                                }))}
                                                className="bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary"
                                                placeholder="Tamano fuente"
                                            />
                                        </div>
                                        <p className="text-[11px] text-muted-dark">
                                            Esta plantilla se usara automaticamente en Completados para generar la imagen de creditos del proyecto.
                                        </p>
                                    </div>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Imagen URL (Portada)</label>
                                    <input
                                        type="text"
                                        value={currentProject.imagen_url}
                                        onChange={e => setCurrentProject({ ...currentProject, imagen_url: e.target.value })}
                                        className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                                        placeholder="https://..."
                                    />
                                    {currentProject.imagen_url && (
                                        <div className="mt-2 h-32 w-24 mx-auto rounded overflow-hidden border border-gray-700">
                                            <img src={currentProject.imagen_url} className="w-full h-full object-cover" alt="Preview" />
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Estado</label>
                                    <select
                                        value={currentProject.estado}
                                        onChange={e => setCurrentProject({ ...currentProject, estado: e.target.value })}
                                        className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                                    >
                                        <option>Activo</option>
                                        <option>Pausado</option>
                                        <option>Finalizado</option>
                                        <option>Cancelado</option>
                                    </select>
                                </div>
                            </div>
                            {saveError && (
                                <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
                                    {saveError}
                                </div>
                            )}
                            <div className="pt-4 flex flex-col sm:flex-row gap-3 sm:gap-4">
                                {isEditing && (
                                    <button
                                        type="button"
                                        onClick={handleDeleteClick}
                                        className="w-full sm:w-auto px-4 py-3 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-lg font-bold transition-colors"
                                    >
                                        <span className="material-icons-round">delete</span>
                                    </button>
                                )}
                                <button
                                    type="submit"
                                    className="flex-1 bg-primary hover:bg-primary-dark text-white font-bold py-3 rounded-lg shadow-lg shadow-primary/20 transition-all"
                                >
                                    {isEditing ? 'Guardar Cambios' : 'Crear Proyecto'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {progressProject && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                    <div className="bg-surface-dark w-full max-w-3xl rounded-2xl border border-gray-800 shadow-2xl overflow-hidden animate-fade-in">
                        <div className="bg-surface-darker p-4 border-b border-gray-800 flex justify-between items-center">
                            <h3 className="font-display font-bold text-xl text-white">
                                Progreso por Rol
                            </h3>
                            <button onClick={() => setProgressProject(null)} className="text-gray-400 hover:text-white">
                                <span className="material-icons-round">close</span>
                            </button>
                        </div>
                        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
                            <div>
                                <p className="text-white font-bold text-lg">{progressProject.titulo}</p>
                                <p className="text-xs text-muted-dark">Avance real por Traduccion, Typeo y Redraw para asignar parejo.</p>
                            </div>

                            {progressLoading ? (
                                <div className="space-y-3">
                                    <div className="h-20 rounded-xl bg-gray-800/40 animate-pulse"></div>
                                    <div className="h-20 rounded-xl bg-gray-800/40 animate-pulse"></div>
                                </div>
                            ) : progressData ? (
                                <>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        <div className="p-3 rounded-xl border border-gray-800 bg-background-dark">
                                            <p className="text-[10px] uppercase text-muted-dark font-bold">Capitulos Base</p>
                                            <p className="text-2xl font-display font-bold text-white">{progressData.summary.total_capitulos}</p>
                                        </div>
                                        <div className="p-3 rounded-xl border border-gray-800 bg-background-dark">
                                            <p className="text-[10px] uppercase text-muted-dark font-bold">Traducidos</p>
                                            <p className="text-2xl font-display font-bold text-primary">{progressData.summary.traductor_completados}</p>
                                        </div>
                                        <div className="p-3 rounded-xl border border-gray-800 bg-background-dark">
                                            <p className="text-[10px] uppercase text-muted-dark font-bold">Typeados</p>
                                            <p className="text-2xl font-display font-bold text-blue-400">{progressData.summary.typer_completados}</p>
                                        </div>
                                        <div className="p-3 rounded-xl border border-gray-800 bg-background-dark">
                                            <p className="text-[10px] uppercase text-muted-dark font-bold">Redraw</p>
                                            <p className="text-2xl font-display font-bold text-emerald-400">{progressData.summary.redrawer_completados}</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div className="p-3 rounded-xl border border-gray-800 bg-background-dark">
                                            <p className="text-xs font-bold text-white mb-2">Pendientes Traduccion</p>
                                            <p className="text-xs text-muted-dark break-words">{progressData.missing.traductor.slice(0, 20).join(', ') || 'Ninguno'}</p>
                                        </div>
                                        <div className="p-3 rounded-xl border border-gray-800 bg-background-dark">
                                            <p className="text-xs font-bold text-white mb-2">Pendientes Typeo</p>
                                            <p className="text-xs text-muted-dark break-words">{progressData.missing.typer.slice(0, 20).join(', ') || 'Ninguno'}</p>
                                        </div>
                                        <div className="p-3 rounded-xl border border-gray-800 bg-background-dark">
                                            <p className="text-xs font-bold text-white mb-2">Pendientes Redraw</p>
                                            <p className="text-xs text-muted-dark break-words">{progressData.missing.redrawer.slice(0, 20).join(', ') || 'Ninguno'}</p>
                                        </div>
                                    </div>

                                    <div className="border border-gray-800 rounded-xl overflow-hidden">
                                        <div className="grid grid-cols-4 bg-surface-darker text-[10px] uppercase font-bold tracking-wider text-muted-dark">
                                            <div className="p-2">Cap</div>
                                            <div className="p-2 text-center">Trad</div>
                                            <div className="p-2 text-center">Type</div>
                                            <div className="p-2 text-center">Redraw</div>
                                        </div>
                                        <div className="max-h-64 overflow-y-auto divide-y divide-gray-800">
                                            {progressData.chapters.map((c) => (
                                                <div key={c.label} className="grid grid-cols-4 text-sm text-gray-200">
                                                    <div className="p-2 font-bold">{c.label}</div>
                                                    <div className="p-2 text-center">{c.traductor ? '✅' : '—'}</div>
                                                    <div className="p-2 text-center">{c.typer ? '✅' : '—'}</div>
                                                    <div className="p-2 text-center">{c.redrawer ? '✅' : '—'}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
                                    No se pudo cargar el progreso del proyecto.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={showConfirmModal}
                title="Eliminar Proyecto"
                message={`¿Estás seguro de eliminar el proyecto "${currentProject.titulo}"? Esta acción no se puede deshacer.`}
                onConfirm={handleConfirmDelete}
                onCancel={() => setShowConfirmModal(false)}
                isDanger={true}
                confirmText="Eliminar"
            />
        </div>
    );
}
