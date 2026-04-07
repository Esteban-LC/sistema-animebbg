'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/context/UserContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useSocket } from '@/context/SocketContext';

type TabKey = 'actuales' | 'historial' | 'mias' | 'votadas';

interface SuggestionItem {
  id: number;
  ronda_id: number;
  titulo: string;
  sinopsis: string;
  tipo_obra: string;
  imagen_url: string;
  url_publicacion: string;
  proyecto_exportado_id?: number | null;
  creado_en: string;
  recomendador_nombre: string;
  recomendador_tag: string;
  votos: number;
  voted_by_me?: boolean;
  voters?: Array<{
    id: number;
    nombre: string;
    tag: string;
    avatar_url: string;
  }>;
}

interface CurrentRound {
  id: number;
  titulo: string;
  descripcion: string;
  estado: 'borrador' | 'activa' | 'pausada' | 'cerrada';
  grupo_nombre: string;
  start_at: string;
  end_at: string;
  eligible_count: number;
  total_votes: number;
  viewer_suggestion_count: number;
  viewer_vote_count: number;
  max_votes_per_round: number;
  viewer_voted: boolean;
  suggestions: SuggestionItem[];
}

interface HistoryItem {
  id: number;
  titulo: string;
  descripcion: string;
  grupo_nombre: string;
  start_at: string;
  end_at: string;
  cerrado_en: string;
  total_votes: number;
  winner_title: string;
  winner_votes: number;
  my_suggestions: number;
  my_vote_title: string;
  suggestions: Array<{
    id: number;
    titulo: string;
    tipo_obra: string;
    sinopsis: string;
    imagen_url: string;
    url_publicacion: string;
    proyecto_exportado_id?: number | null;
    recomendador_nombre: string;
    recomendador_tag: string;
    votos: number;
    voters?: Array<{
      id: number;
      nombre: string;
      tag: string;
      avatar_url: string;
    }>;
  }>;
}

interface MySuggestionItem {
  id: number;
  titulo: string;
  sinopsis: string;
  tipo_obra: string;
  imagen_url: string;
  url_publicacion: string;
  proyecto_exportado_id?: number | null;
  creado_en: string;
  ronda_titulo: string;
  ronda_estado: string;
  start_at: string;
  end_at: string;
  votos: number;
}

interface MyVoteItem {
  sugerencia_id: number;
  sugerencia_titulo: string;
  ronda_titulo: string;
  ronda_estado: string;
  start_at: string;
  end_at: string;
  voted_at: string;
}

interface SuggestionResponse {
  viewer: {
    id: number;
    grupo_nombre?: string | null;
    isAdmin: boolean;
    isLeader: boolean;
  };
  config: {
    round_id?: number;
    start_at: string;
    end_at: string;
    status: string;
  };
  current: CurrentRound | null;
  history: HistoryItem[];
  mySuggestions: MySuggestionItem[];
  myVotes: MyVoteItem[];
}

interface VoteConfirmState {
  type: 'vote' | 'unvote';
  suggestionId: number;
  title: string;
  message: string;
  confirmText: string;
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'actuales', label: 'Todas las sugerencias' },
  { key: 'historial', label: 'Historial' },
  { key: 'mias', label: 'Mis propuestas' },
  { key: 'votadas', label: 'Votadas por mi' },
];

const STATE_STYLES: Record<string, string> = {
  borrador: 'text-gray-300 border-gray-600 bg-gray-500/10',
  activa: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  pausada: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  cerrada: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
};

function formatDateTime(value?: string | null) {
  if (!value) return 'Sin fecha';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function stateLabel(value: string) {
  if (value === 'borrador') return 'Programada';
  if (value === 'activa') return 'Activa';
  if (value === 'pausada') return 'Pausada';
  if (value === 'cerrada') return 'Cerrada';
  return value;
}

function voteLabel(total: number) {
  return `${total} voto${total === 1 ? '' : 's'}`;
}

function CoverCard({
  title,
  subtitle,
  imageUrl,
  badge,
  meta,
  footer,
  children,
  imageAction,
  imageOverlay,
}: {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  badge?: ReactNode;
  meta?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  imageAction?: ReactNode;
  imageOverlay?: ReactNode;
}) {
  return (
    <article className="group bg-surface-dark rounded-xl overflow-hidden border border-gray-800 shadow-lg max-w-[220px] w-full">
      <div className="relative aspect-[4/5] bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        {imageUrl ? (
          <img src={imageUrl} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-[radial-gradient(circle_at_top_left,_rgba(239,68,68,0.35),_transparent_35%),linear-gradient(135deg,_rgba(17,24,39,0.95),_rgba(3,7,18,1))]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" />
        {imageOverlay && <div className="absolute inset-0 z-10">{imageOverlay}</div>}
        {imageAction && <div className="absolute inset-0 z-20 md:hidden">{imageAction}</div>}
        {badge && <div className="absolute top-2.5 right-2.5 z-10">{badge}</div>}
        <div className="absolute inset-x-0 bottom-0 p-2 z-10">
          {subtitle && <p className="text-[8px] uppercase tracking-[0.22em] text-primary font-bold mb-1">{subtitle}</p>}
          <h3 className="text-[15px] font-bold text-white leading-tight drop-shadow-md line-clamp-2">{title}</h3>
          {meta && <div className="mt-1">{meta}</div>}
        </div>
      </div>
      <div className="p-2 space-y-2">
        {children}
        {footer}
      </div>
    </article>
  );
}

export default function SugerenciasPage() {
  const { user, loading: userLoading } = useUser();
  const router = useRouter();
  const { showToast } = useToast();
  const { socket } = useSocket();
  const [activeTab, setActiveTab] = useState<TabKey>('actuales');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<SuggestionResponse | null>(null);
  const [configForm, setConfigForm] = useState({ start_at: '', end_at: '' });
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HistoryItem | null>(null);
  const [voteConfirm, setVoteConfirm] = useState<VoteConfirmState | null>(null);
  const [mobileVoteCardId, setMobileVoteCardId] = useState<number | null>(null);
  const [proposalForm, setProposalForm] = useState({
    titulo: '',
    tipo_obra: 'Manga',
    url_publicacion: '',
    imagen_url: '',
    sinopsis: '',
  });

  const roles = user?.roles || [];
  const canManage = Boolean(user?.isAdmin || roles.includes('Administrador') || roles.includes('Lider de Grupo'));
  const isLeader = roles.includes('Lider de Grupo');
  const groupSuggestionsVisible = user?.groupSettings?.showSuggestions !== false;
  const canViewSuggestions = Boolean(user?.isAdmin || roles.includes('Administrador') || isLeader || groupSuggestionsVisible);

  useEffect(() => {
    if (userLoading || !user) return;
    if (!user.isAdmin && !isLeader && (user.rango ?? 1) < 2) {
      router.replace('/asignaciones');
    }
  }, [userLoading, user, isLeader, router]);
  const canManageGroupVisibility = Boolean(user?.grupo_id && canManage);

  if (user && !canViewSuggestions && !canManageGroupVisibility) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background-dark text-muted-dark p-6">
        Las sugerencias estan ocultas para este grupo.
      </div>
    );
  }

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch('/api/sugerencias');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudieron cargar las sugerencias');
      setData(json);
      setConfigForm({
        start_at: json.config?.start_at || '',
        end_at: json.config?.end_at || '',
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Error cargando sugerencias', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user?.id]);

  useEffect(() => {
    if (!socket) return;
    const handleContentChanged = () => {
      loadData();
    };
    socket.on('content-changed', handleContentChanged);
    return () => {
      socket.off('content-changed', handleContentChanged);
    };
  }, [socket]);

  async function saveSchedule() {
    if (!configForm.start_at || !configForm.end_at) return;
    setSaving(true);
    try {
      const res = await fetch('/api/sugerencias', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_schedule',
          start_at: configForm.start_at,
          end_at: configForm.end_at,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo guardar el periodo');
      showToast('Periodo de votacion actualizado', 'success');
      await loadData();
      socket?.emit('content-changed');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Error guardando periodo', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function setGroupSuggestionVisibility(hidden: boolean) {
    setSaving(true);
    try {
      const res = await fetch('/api/grupos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user?.grupo_id, mostrar_sugerencias: !hidden }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'No se pudo actualizar la visibilidad');
      showToast(hidden ? 'Sugerencias ocultas para el staff de este grupo' : 'Sugerencias visibles para el staff de este grupo', 'success');
      window.location.reload();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Error actualizando visibilidad', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function createSuggestion() {
    if (!proposalForm.titulo.trim() || !proposalForm.url_publicacion.trim() || !proposalForm.imagen_url.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/sugerencias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'suggestion',
          ...proposalForm,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo publicar la sugerencia');
      setProposalForm({
        titulo: '',
        tipo_obra: 'Manga',
        url_publicacion: '',
        imagen_url: '',
        sinopsis: '',
      });
      setMobileVoteCardId(null);
      showToast('Sugerencia publicada', 'success');
      await loadData();
      socket?.emit('content-changed');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Error publicando sugerencia', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function exportToProject(suggestionId: number) {
    setSaving(true);
    try {
      const res = await fetch('/api/sugerencias', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'export_to_project',
          sugerencia_id: suggestionId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo enviar a proyectos');
      showToast(json.reused ? 'Proyecto ya existente vinculado' : 'Sugerencia agregada a proyectos', 'success');
      await loadData();
      socket?.emit('content-changed');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Error exportando a proyectos', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function vote(suggestionId: number) {
    setSaving(true);
    try {
      const res = await fetch('/api/sugerencias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'vote', sugerencia_id: suggestionId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo registrar el voto');
      setMobileVoteCardId(null);
      showToast(json.already_voted ? 'Ese voto ya estaba registrado' : 'Voto registrado', 'success');
      await loadData();
      socket?.emit('content-changed');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Error registrando voto', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function unvote(suggestionId: number) {
    setSaving(true);
    try {
      const res = await fetch('/api/sugerencias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'unvote', sugerencia_id: suggestionId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo quitar el voto');
      setMobileVoteCardId(null);
      showToast('Voto retirado', 'success');
      await loadData();
      socket?.emit('content-changed');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Error quitando voto', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function updateCurrentState(action: 'start' | 'pause' | 'resume' | 'close') {
    if (!data?.current?.id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sugerencias/rounds/${data.current.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo actualizar el estado');
      showToast('Estado de votacion actualizado', 'success');
      await loadData();
      socket?.emit('content-changed');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Error actualizando votacion', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function deleteRound(roundId: number) {
    setSaving(true);
    try {
      const res = await fetch(`/api/sugerencias/rounds/${roundId}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo eliminar el periodo');
      showToast('Periodo eliminado', 'success');
      setDeleteTarget(null);
      setExpandedHistoryId((prev) => (prev === roundId ? null : prev));
      await loadData();
      socket?.emit('content-changed');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Error eliminando periodo', 'error');
    } finally {
      setSaving(false);
    }
  }

  const current = data?.current || null;
  const currentSuggestions = useMemo(() => current?.suggestions || [], [current]);
  const canCreateSuggestion = current?.estado === 'activa';
  const remainingVotes = Math.max(0, (current?.max_votes_per_round || 0) - (current?.viewer_vote_count || 0));

  function openProposalTab() {
    setActiveTab('mias');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function toggleMobileVoteCard(suggestionId: number) {
    setMobileVoteCardId((prev) => (prev === suggestionId ? null : suggestionId));
  }

  function requestVote(item: SuggestionItem) {
    const alreadyReachedLimit = Boolean(current && !item.voted_by_me && current.viewer_vote_count >= current.max_votes_per_round);
    setVoteConfirm({
      type: 'vote',
      suggestionId: item.id,
      title: item.voted_by_me ? 'Confirmar voto' : 'Registrar voto',
      message: alreadyReachedLimit
        ? `Ya usaste tus ${current?.max_votes_per_round || 3} votos de este periodo. Quita uno antes de votar por "${item.titulo}".`
        : item.voted_by_me
          ? `Ya votaste por "${item.titulo}". Si continuas, solo se confirmara ese voto.`
          : `¿Seguro que quieres votar por "${item.titulo}"?`,
      confirmText: alreadyReachedLimit ? 'Entendido' : 'Confirmar',
    });
  }

  function requestUnvote(item: SuggestionItem) {
    setVoteConfirm({
      type: 'unvote',
      suggestionId: item.id,
      title: 'Quitar voto',
      message: `¿Seguro que quieres quitar tu voto de "${item.titulo}"?`,
      confirmText: 'Quitar voto',
    });
  }

  async function handleVoteConfirm() {
    if (!voteConfirm) return;

    if (voteConfirm.type === 'vote') {
      const item = currentSuggestions.find((entry) => entry.id === voteConfirm.suggestionId);
      if (current && item && !item.voted_by_me && current.viewer_vote_count >= current.max_votes_per_round) {
        setVoteConfirm(null);
        return;
      }
      await vote(voteConfirm.suggestionId);
      setVoteConfirm(null);
      return;
    }

    await unvote(voteConfirm.suggestionId);
    setVoteConfirm(null);
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-background-dark overflow-hidden">
      <header className="h-20 bg-surface-dark border-b border-gray-800 hidden md:flex items-center justify-between px-6 lg:px-8 z-10 sticky top-0 shrink-0">
        <div>
          <h1 className="font-display font-bold text-2xl lg:text-3xl uppercase tracking-wider text-white">
            <span className="text-primary">Sugerencias</span>
          </h1>
          <p className="text-xs uppercase tracking-widest text-muted-dark mt-1">Panel de propuestas y votaciones</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 lg:p-8 pb-32 md:pb-8">
        <div className="max-w-[1600px] mx-auto space-y-6">
          <div className="border-b border-gray-800">
            <div className="flex items-end gap-4">
              <div className="flex-1 min-w-0 overflow-x-auto">
                <div className="flex gap-6 min-w-max">
                  {TABS.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`pb-3 text-sm font-bold tracking-wide transition-colors border-b-2 ${activeTab === tab.key ? 'text-primary border-primary' : 'text-muted-dark border-transparent hover:text-white'
                        }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
              {canCreateSuggestion && (
                <button
                  onClick={openProposalTab}
                  className="hidden md:inline-flex items-center gap-2 self-center mb-3 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold whitespace-nowrap shadow-[0_8px_24px_rgba(255,46,77,0.22)] hover:bg-primary-dark transition-colors"
                >
                  <span className="material-icons-round text-base">add</span>
                  Nueva sugerencia
                </button>
              )}
            </div>
          </div>

          {canManage && (
            <div className="rounded-2xl border border-gray-800 bg-gradient-to-br from-surface-dark to-surface-darker p-5">
              <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-dark font-bold">Control de votacion</p>
                  <h2 className="text-lg font-display font-bold text-white">Periodo actual</h2>
                </div>
                {current && (
                  <div className="flex flex-wrap gap-2">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold border ${STATE_STYLES[current.estado] || STATE_STYLES.borrador}`}>
                      {stateLabel(current.estado)}
                    </span>
                    {current.estado === 'borrador' && (
                      <button onClick={() => updateCurrentState('start')} disabled={saving} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-50">Iniciar</button>
                    )}
                    {current.estado === 'activa' && (
                      <button onClick={() => updateCurrentState('pause')} disabled={saving} className="px-4 py-2 rounded-xl bg-amber-500 text-black text-sm font-bold disabled:opacity-50">Pausar</button>
                    )}
                    {current.estado === 'pausada' && (
                      <button onClick={() => updateCurrentState('resume')} disabled={saving} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold disabled:opacity-50">Reanudar</button>
                    )}
                    {current.estado !== 'cerrada' && (
                      <button onClick={() => updateCurrentState('close')} disabled={saving} className="px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-bold disabled:opacity-50">Cerrar</button>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 mt-4">
                <label className="lg:col-span-1 bg-black/20 border border-gray-700 rounded-xl p-3">
                  <span className="text-[10px] uppercase tracking-widest text-muted-dark font-bold">Inicio</span>
                  <input
                    type="datetime-local"
                    value={configForm.start_at}
                    onChange={(e) => setConfigForm((prev) => ({ ...prev, start_at: e.target.value }))}
                    className="mt-2 w-full bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                  />
                </label>
                <label className="lg:col-span-1 bg-black/20 border border-gray-700 rounded-xl p-3">
                  <span className="text-[10px] uppercase tracking-widest text-muted-dark font-bold">Fin</span>
                  <input
                    type="datetime-local"
                    value={configForm.end_at}
                    onChange={(e) => setConfigForm((prev) => ({ ...prev, end_at: e.target.value }))}
                    className="mt-2 w-full bg-background-dark border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                  />
                </label>
                <div className="lg:col-span-2 bg-black/20 border border-gray-700 rounded-xl p-3 flex flex-col justify-center">
                  <p className="text-sm text-gray-300">
                    Define el rango oficial para la votacion. Con eso se toma la votacion actual y, cuando cierre, se ira al historial.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={saveSchedule}
                      disabled={saving || !configForm.start_at || !configForm.end_at}
                      className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50 w-full md:w-fit"
                    >
                      Guardar periodo
                    </button>
                    {canManageGroupVisibility && (
                      <button
                        onClick={() => setGroupSuggestionVisibility(groupSuggestionsVisible)}
                        disabled={saving}
                        className="px-4 py-2.5 rounded-xl bg-surface-darker border border-gray-600 text-white text-sm font-bold disabled:opacity-50 w-full md:w-fit"
                      >
                        {groupSuggestionsVisible ? 'Ocultar para este grupo' : 'Mostrar para este grupo'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'mias' && canCreateSuggestion && (
            <div className="rounded-2xl border border-gray-800 bg-surface-dark p-5">
              <div className="flex items-center gap-3 mb-5">
                <span className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold">+</span>
                <p className="text-lg font-bold text-white uppercase">Publicar sugerencia</p>
              </div>
              <div className="mt-4 flex flex-col lg:flex-row lg:items-start gap-6">
                <div className="flex-1 min-w-0 space-y-4">
                  <div>
                    <label className="block text-[10px] uppercase tracking-[0.22em] text-muted-dark font-bold mb-2">
                      Nombre del proyecto
                    </label>
                    <input
                      value={proposalForm.titulo}
                      onChange={(e) => setProposalForm((prev) => ({ ...prev, titulo: e.target.value }))}
                      placeholder="Manga / Manhwa / Novela"
                      className="w-full bg-background-dark border border-gray-700 rounded-xl px-4 py-3 text-white placeholder:text-gray-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-[0.22em] text-muted-dark font-bold mb-2">
                      Categoria
                    </label>
                    <select
                      value={proposalForm.tipo_obra}
                      onChange={(e) => setProposalForm((prev) => ({ ...prev, tipo_obra: e.target.value }))}
                      className="w-full bg-background-dark border border-gray-700 rounded-xl px-4 py-3 text-white"
                    >
                      <option value="Manga">Manga</option>
                      <option value="Manhwa">Manhwa</option>
                      <option value="Manhua">Manhua</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-[0.22em] text-muted-dark font-bold mb-2">
                      URL de la publicacion
                    </label>
                    <input
                      value={proposalForm.url_publicacion}
                      onChange={(e) => setProposalForm((prev) => ({ ...prev, url_publicacion: e.target.value }))}
                      placeholder="Ej: https://mangadex.org/..."
                      className="w-full bg-background-dark border border-gray-700 rounded-xl px-4 py-3 text-white placeholder:text-gray-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-[0.22em] text-muted-dark font-bold mb-2">
                      Sinopsis (opcional)
                    </label>
                    <textarea
                      value={proposalForm.sinopsis}
                      onChange={(e) => setProposalForm((prev) => ({ ...prev, sinopsis: e.target.value }))}
                      placeholder="Escribe un breve resumen del proyecto..."
                      rows={6}
                      className="w-full bg-background-dark border border-gray-700 rounded-xl px-4 py-3 text-white placeholder:text-gray-500 resize-none"
                    />
                  </div>
                </div>

                <div className="w-full lg:w-[340px] lg:shrink-0 flex flex-col items-center">
                  <label className="block text-[10px] uppercase tracking-[0.22em] text-muted-dark font-bold mb-2">
                    Previsualizador de portada
                  </label>
                  <div className="min-h-[286px] w-full flex items-center justify-center">
                    <div className="w-full max-w-[210px]">
                      <div className="aspect-[2/3] rounded-2xl overflow-hidden flex items-center justify-center relative mx-auto bg-[#06080d] shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                        {proposalForm.imagen_url ? (
                          <img
                            src={proposalForm.imagen_url}
                            alt="Preview portada"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="text-center px-6">
                            <div className="w-14 h-14 rounded-lg bg-slate-700/80 mx-auto flex items-center justify-center text-slate-300">
                              <span className="material-icons-round text-3xl">image</span>
                            </div>
                            <p className="text-sm text-slate-300 font-semibold mt-4 uppercase tracking-[0.18em]">Vista previa</p>
                            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-dark mt-2">No se ha seleccionado imagen</p>
                          </div>
                        )}
                        {proposalForm.imagen_url && <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />}
                      </div>
                    </div>
                  </div>

                  <div className="w-full max-w-[340px] mt-5">
                    <label className="block text-[10px] uppercase tracking-[0.22em] text-muted-dark font-bold mb-2 text-center">
                      URL de portada
                    </label>
                    <input
                      value={proposalForm.imagen_url}
                      onChange={(e) => setProposalForm((prev) => ({ ...prev, imagen_url: e.target.value }))}
                      placeholder="Pega el enlace de la imagen"
                      className="w-full bg-background-dark border border-gray-700 rounded-xl px-4 py-3 text-white placeholder:text-gray-500"
                    />
                  </div>

                  <button
                    onClick={createSuggestion}
                    disabled={saving || !proposalForm.titulo.trim() || !proposalForm.url_publicacion.trim() || !proposalForm.imagen_url.trim()}
                    className="mt-6 w-full lg:w-auto min-w-[180px] rounded-xl px-6 py-3 bg-red-500 text-white font-bold disabled:opacity-50"
                  >
                    Publicar sugerencia
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'actuales' && (
            <div className="space-y-5">
              {current ? (
                <>
                  <div className="rounded-2xl border border-gray-800 bg-gradient-to-r from-surface-dark to-surface-darker p-5">
                    <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                      <div>
                        <div className="flex items-center flex-wrap gap-2">
                          <h2 className="text-xl font-display font-bold text-white">{current.titulo}</h2>
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold border ${STATE_STYLES[current.estado] || STATE_STYLES.borrador}`}>
                            {stateLabel(current.estado)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-300 mt-2">{current.descripcion || 'Periodo oficial de sugerencias.'}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-muted-dark">
                          <span>Inicio: {formatDateTime(current.start_at)}</span>
                          <span>Fin: {formatDateTime(current.end_at)}</span>
                          <span>Tus votos: {current.viewer_vote_count}/{current.max_votes_per_round}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 justify-items-start">
                    {currentSuggestions.map((item) => {
                      return (
                        <CoverCard
                          key={item.id}
                          title={item.titulo}
                          subtitle={item.tipo_obra}
                          imageUrl={item.imagen_url}
                          badge={
                            item.voted_by_me ? (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-[9px] font-bold border border-white/20 bg-black/45 text-white backdrop-blur">
                                Votado
                              </span>
                            ) : undefined
                          }
                          imageAction={
                            <button
                              type="button"
                              onClick={() => toggleMobileVoteCard(item.id)}
                              className="w-full h-full"
                              aria-label={mobileVoteCardId === item.id ? 'Ocultar acciones de voto' : 'Mostrar acciones de voto'}
                            />
                          }
                          meta={
                            <>
                              {item.sinopsis && <p className="text-[11px] text-gray-200 line-clamp-2">{item.sinopsis}</p>}
                              <div className="mt-1.5 inline-flex items-center rounded-full bg-black/45 px-2 py-1 text-[10px] font-bold text-white border border-white/10">
                                {voteLabel(item.votos)}
                              </div>
                            </>
                          }
                          footer={
                            <>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="text-[10px] uppercase tracking-widest text-muted-dark font-bold">Recomendo</p>
                                  <p className="text-sm text-white font-semibold truncate">
                                    {item.recomendador_tag ? `@${item.recomendador_tag}` : item.recomendador_nombre || 'Sin tag'}
                                  </p>
                                </div>
                                <a
                                  href={item.url_publicacion}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hidden md:inline-flex shrink-0 px-2.5 py-1.5 rounded-xl border border-gray-700 text-[10px] font-bold text-white hover:border-primary"
                                >
                                  Ver fuente
                                </a>
                              </div>
                              <a
                                href={item.url_publicacion}
                                target="_blank"
                                rel="noreferrer"
                                className="md:hidden inline-flex w-full items-center justify-center px-2.5 py-2 rounded-xl border border-gray-700 text-[11px] font-bold text-white hover:border-primary"
                              >
                                Ver fuente
                              </a>
                              <div>
                                <p className="text-[10px] uppercase tracking-widest text-muted-dark font-bold mb-2">Votaron</p>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {(item.voters || []).length > 0 ? (
                                    (item.voters || []).map((voter) => (
                                      <div
                                        key={voter.id}
                                        title={voter.tag ? `@${voter.tag}` : voter.nombre}
                                        className="w-7 h-7 rounded-full border border-gray-700 overflow-hidden bg-background-dark flex items-center justify-center text-[9px] font-bold text-white"
                                      >
                                        {voter.avatar_url ? (
                                          <img src={voter.avatar_url} alt={voter.nombre} className="w-full h-full object-cover" />
                                        ) : (
                                          <span>{String(voter.nombre || '?').slice(0, 1).toUpperCase()}</span>
                                        )}
                                      </div>
                                    ))
                                  ) : (
                                    <span className="text-[11px] text-muted-dark">Sin votos aun</span>
                                  )}
                                </div>
                              </div>
                              {canManage && (
                                <button
                                  onClick={() => exportToProject(item.id)}
                                  disabled={saving || Boolean(item.proyecto_exportado_id)}
                                  className="w-full px-3 py-2 rounded-xl text-[11px] font-bold border border-gray-700 text-white hover:border-primary disabled:opacity-50"
                                >
                                  {item.proyecto_exportado_id ? 'Ya agregado a proyectos' : 'Agregar a proyectos'}
                                </button>
                              )}
                              <div className="hidden md:flex gap-2">
                                {item.voted_by_me && (
                                  <button
                                    onClick={() => requestUnvote(item)}
                                    disabled={saving || current.estado !== 'activa'}
                                    className="flex-1 px-3 py-2 rounded-xl text-[11px] font-bold border border-gray-700 text-white hover:border-amber-400 disabled:opacity-50"
                                  >
                                    Quitar voto
                                  </button>
                                )}
                                <button
                                  onClick={() => requestVote(item)}
                                  disabled={saving || current.estado !== 'activa'}
                                  className={`flex-1 px-3 py-2 rounded-xl text-[11px] font-bold ${item.voted_by_me ? 'bg-white text-black' : 'bg-red-500 text-white'
                                    } disabled:opacity-50`}
                                >
                                  {item.voted_by_me ? 'Confirmar voto' : 'Votar'}
                                </button>
                              </div>
                              {mobileVoteCardId === item.id && (
                                <div className="md:hidden space-y-2">
                                  {item.voted_by_me && (
                                    <button
                                      onClick={() => requestUnvote(item)}
                                      disabled={saving || current.estado !== 'activa'}
                                      className="w-full px-3 py-2 rounded-xl text-[11px] font-bold border border-gray-700 text-white hover:border-amber-400 disabled:opacity-50"
                                    >
                                      Quitar voto
                                    </button>
                                  )}
                                  <button
                                    onClick={() => requestVote(item)}
                                    disabled={saving || current.estado !== 'activa'}
                                    className={`w-full px-3 py-2 rounded-xl text-[11px] font-bold ${item.voted_by_me ? 'bg-white text-black' : 'bg-red-500 text-white'
                                      } disabled:opacity-50`}
                                  >
                                    {item.voted_by_me ? 'Confirmar voto' : 'Votar'}
                                  </button>
                                </div>
                              )}
                            </>
                          }
                        />
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-gray-700 bg-surface-dark p-10 text-center">
                  <p className="text-white font-bold text-lg">No hay votacion actual configurada.</p>
                  <p className="text-muted-dark mt-2">
                    {canManage ? 'Define un rango de fecha y hora para abrir la votacion.' : 'Espera a que administracion configure el periodo oficial.'}
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'historial' && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {(data?.history || []).map((item) => (
                <div key={item.id} className="rounded-2xl border border-gray-800 bg-surface-dark p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-display font-bold text-white">{item.titulo}</h3>
                      <p className="text-sm text-gray-300 mt-1">{item.descripcion || 'Sin descripcion adicional.'}</p>
                    </div>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold border ${STATE_STYLES.cerrada}`}>
                      Cerrada
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <div className="rounded-xl border border-gray-800 bg-background-dark p-3">
                      <p className="text-[10px] uppercase tracking-widest text-muted-dark font-bold">Ganadora</p>
                      <p className="text-sm text-white font-semibold mt-1">{item.winner_title || 'Sin votos'}</p>
                    </div>
                    <div className="rounded-xl border border-gray-800 bg-background-dark p-3">
                      <p className="text-[10px] uppercase tracking-widest text-muted-dark font-bold">Tu voto</p>
                      <p className="text-sm text-white font-semibold mt-1">{item.my_vote_title || 'No votaste'}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 text-xs text-muted-dark">
                    <span>Inicio: {formatDateTime(item.start_at)}</span>
                    <span>Fin: {formatDateTime(item.end_at)}</span>
                    <span>Total votos: {item.total_votes}</span>
                    <span>Tus propuestas: {item.my_suggestions}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    <button
                      onClick={() => setExpandedHistoryId((prev) => (prev === item.id ? null : item.id))}
                      className="px-3 py-2 rounded-xl border border-gray-700 text-xs font-bold text-white hover:border-primary"
                    >
                      {expandedHistoryId === item.id ? 'Ocultar detalle' : 'Ver propuestas y votos'}
                    </button>
                    {canManage && (
                      <button
                        onClick={() => setDeleteTarget(item)}
                        className="px-3 py-2 rounded-xl border border-red-500/40 text-xs font-bold text-red-300 hover:bg-red-500/10"
                      >
                        Eliminar periodo
                      </button>
                    )}
                  </div>
                  {expandedHistoryId === item.id && (
                    <div className="mt-4 border-t border-gray-800 pt-4 space-y-3">
                      {item.suggestions.length > 0 ? (
                        item.suggestions.map((suggestion) => (
                          <div key={suggestion.id} className="rounded-xl border border-gray-800 bg-background-dark p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h4 className="text-sm font-bold text-white">{suggestion.titulo}</h4>
                                <p className="text-xs text-primary mt-1">{suggestion.tipo_obra}</p>
                                {suggestion.sinopsis && <p className="text-xs text-gray-300 mt-2">{suggestion.sinopsis}</p>}
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-lg font-display font-bold text-primary">{suggestion.votos}</p>
                                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-dark">votos</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-muted-dark">
                              <span>Propuso: {suggestion.recomendador_tag ? `@${suggestion.recomendador_tag}` : suggestion.recomendador_nombre || 'Sin tag'}</span>
                              {suggestion.proyecto_exportado_id && <span>En proyectos</span>}
                            </div>
                            <div className="mt-3">
                              <p className="text-[10px] uppercase tracking-widest text-muted-dark font-bold mb-2">Votaron</p>
                              <div className="flex items-center gap-2 flex-wrap">
                                {(suggestion.voters || []).length > 0 ? (
                                  (suggestion.voters || []).map((voter) => (
                                    <div
                                      key={voter.id}
                                      title={voter.tag ? `@${voter.tag}` : voter.nombre}
                                      className="w-8 h-8 rounded-full border border-gray-700 overflow-hidden bg-surface-dark flex items-center justify-center text-[10px] font-bold text-white"
                                    >
                                      {voter.avatar_url ? (
                                        <img src={voter.avatar_url} alt={voter.nombre} className="w-full h-full object-cover" />
                                      ) : (
                                        <span>{String(voter.nombre || '?').slice(0, 1).toUpperCase()}</span>
                                      )}
                                    </div>
                                  ))
                                ) : (
                                  <span className="text-xs text-muted-dark">Sin votos</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl border border-dashed border-gray-700 bg-background-dark p-6 text-center text-muted-dark text-sm">
                          Este periodo no tuvo propuestas.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {!loading && (data?.history || []).length === 0 && (
                <div className="xl:col-span-2 rounded-2xl border border-dashed border-gray-700 bg-surface-dark p-10 text-center text-muted-dark">
                  No hay historial de votaciones cerradas todavia.
                </div>
              )}
            </div>
          )}

          {activeTab === 'mias' && (
            <div className="space-y-4">
              {!canCreateSuggestion && (
                <div className="rounded-2xl border border-dashed border-gray-700 bg-surface-dark p-8 text-center text-muted-dark">
                  No hay un periodo activo para enviar propuestas nuevas.
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 justify-items-start">
                {(data?.mySuggestions || []).map((item) => (
                  <CoverCard
                    key={item.id}
                    title={item.titulo}
                    subtitle={item.tipo_obra}
                    imageUrl={item.imagen_url}
                    badge={
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold border ${STATE_STYLES[item.ronda_estado] || STATE_STYLES.borrador}`}>
                        {stateLabel(item.ronda_estado)}
                      </span>
                    }
                    meta={
                      <p className="text-xs text-gray-200">
                        Periodo: {formatDateTime(item.start_at)} - {formatDateTime(item.end_at)}
                      </p>
                    }
                    footer={
                      <>
                        {item.sinopsis && <p className="text-sm text-gray-300">{item.sinopsis}</p>}
                        <div className="flex flex-wrap gap-2">
                          <a href={item.url_publicacion} target="_blank" rel="noreferrer" className="inline-flex px-2.5 py-1.5 rounded-xl border border-gray-700 text-[10px] font-bold text-white hover:border-primary">
                            Abrir fuente
                          </a>
                          {canManage && (
                            <button
                              onClick={() => exportToProject(item.id)}
                              disabled={saving || Boolean(item.proyecto_exportado_id)}
                              className="inline-flex px-2.5 py-1.5 rounded-xl border border-gray-700 text-[10px] font-bold text-white hover:border-primary disabled:opacity-50"
                            >
                              {item.proyecto_exportado_id ? 'Ya en proyectos' : 'Agregar a proyectos'}
                            </button>
                          )}
                        </div>
                      </>
                    }
                  />
                ))}
                {!loading && (data?.mySuggestions || []).length === 0 && (
                  <div className="lg:col-span-2 rounded-2xl border border-dashed border-gray-700 bg-surface-dark p-10 text-center text-muted-dark">
                    Aun no has enviado propuestas.
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'votadas' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {(data?.myVotes || []).map((item) => (
                <div key={`${item.sugerencia_id}-${item.voted_at}`} className="rounded-2xl border border-gray-800 bg-surface-dark p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-muted-dark font-bold">Votaste por</p>
                      <h3 className="text-lg font-bold text-white mt-1">{item.sugerencia_titulo}</h3>
                    </div>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold border ${STATE_STYLES[item.ronda_estado] || STATE_STYLES.borrador}`}>
                      {stateLabel(item.ronda_estado)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 text-xs text-muted-dark">
                    <span>Periodo: {formatDateTime(item.start_at)} - {formatDateTime(item.end_at)}</span>
                    <span>Registrado: {formatDateTime(item.voted_at)}</span>
                  </div>
                </div>
              ))}
              {!loading && (data?.myVotes || []).length === 0 && (
                <div className="lg:col-span-2 rounded-2xl border border-dashed border-gray-700 bg-surface-dark p-10 text-center text-muted-dark">
                  Todavia no has votado en ninguna sugerencia.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {canCreateSuggestion && (
        <button
          onClick={openProposalTab}
          className="md:hidden fixed right-6 bottom-28 w-16 h-16 rounded-full bg-primary text-white shadow-[0_10px_30px_rgba(255,46,77,0.35)] flex items-center justify-center z-40"
        >
          <span className="material-icons-round text-3xl">add</span>
        </button>
      )}

      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        title="Eliminar periodo"
        message={`Se eliminaran el periodo, sus propuestas y sus votos. ¿Seguro que quieres borrar "${deleteTarget?.titulo || 'este periodo'}"?`}
        onConfirm={() => {
          if (deleteTarget?.id) deleteRound(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
        confirmText="Eliminar"
        cancelText="Cancelar"
        isDanger
      />

      <ConfirmModal
        isOpen={Boolean(voteConfirm)}
        title={voteConfirm?.title || 'Confirmar'}
        message={voteConfirm?.message || ''}
        onConfirm={handleVoteConfirm}
        onCancel={() => setVoteConfirm(null)}
        confirmText={voteConfirm?.confirmText || 'Confirmar'}
        cancelText="Cancelar"
        isDanger={voteConfirm?.type === 'unvote'}
      />
    </div>
  );
}
