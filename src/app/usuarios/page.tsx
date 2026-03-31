'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Check, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/context/ToastContext';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useUser } from '@/context/UserContext';

interface Grupo {
    id: number;
    nombre: string;
}

interface Usuario {
    id: number;
    nombre: string;
    tag?: string;
    nombre_creditos?: string;
    roles: string[];
    grupo_id?: number;
    grupo_nombre?: string;
    activo: number;
    creado_en: string;
}

const AVAILABLE_ROLES = [
    'Administrador',
    'Lider de Grupo',
    'Redrawer',
    'Traductor',
    'Traductor ENG',
    'Traductor KO',
    'Traductor JAP',
    'Typer'
];

const LEADER_ALLOWED_ROLES = [
    'Lider de Grupo',
    'Redrawer',
    'Traductor',
    'Traductor ENG',
    'Traductor KO',
    'Traductor JAP',
    'Typer'
];

export default function UsuariosPage() {
    const { user } = useUser();
    const [usuarios, setUsuarios] = useState<Usuario[]>([]);
    const [grupos, setGrupos] = useState<Grupo[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [nuevoUsuario, setNuevoUsuario] = useState({
        nombre: '',
        tag: '',
        nombre_creditos: '',
        roles: [] as string[],
        grupo_id: ''
    });
    const [nuevoGrupo, setNuevoGrupo] = useState('');
    const [showGrupoModal, setShowGrupoModal] = useState(false);

    // Delete handling
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [userToDelete, setUserToDelete] = useState<Usuario | null>(null);

    const { showToast } = useToast();

    // Determine permissions
    const roles = user?.roles || [];
    const isAdmin = roles.includes('Administrador') || user?.role === 'admin';
    const isLeader = roles.includes('Lider de Grupo') || user?.role === 'Lider de Grupo';
    const canManageUsers = isAdmin;
    const assignableRoles = isAdmin ? AVAILABLE_ROLES : LEADER_ALLOWED_ROLES;

    useEffect(() => {
        fetchUsuarios();
        fetchGrupos();
    }, []);

    const fetchUsuarios = async () => {
        try {
            const res = await fetch('/api/usuarios');
            const data = await res.json();
            setUsuarios(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const fetchGrupos = async () => {
        try {
            const res = await fetch('/api/grupos');
            const data = await res.json();
            setGrupos(data);
        } catch (err) {
            console.error(err);
        }
    };

    const handleCreateGrupo = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await fetch('/api/grupos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre: nuevoGrupo }),
            });
            if (res.ok) {
                setNuevoGrupo('');
                setShowGrupoModal(false);
                fetchGrupos();
            }
        } catch (err) {
            console.error(err);
        }
    };

    const toggleStatus = async (id: number, currentStatus: number) => {
        if (!canManageUsers) return;
        try {
            const newStatus = currentStatus === 1 ? 0 : 1;
            const res = await fetch(`/api/usuarios/${id}/toggle-status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activo: newStatus }),
            });
            if (res.ok) {
                fetchUsuarios();
            }
        } catch (err) {
            console.error(err);
        }
    };

    const toggleRole = (role: string) => {
        if (nuevoUsuario.roles.includes(role)) {
            setNuevoUsuario({
                ...nuevoUsuario,
                roles: nuevoUsuario.roles.filter(r => r !== role)
            });
        } else {
            setNuevoUsuario({
                ...nuevoUsuario,
                roles: [...nuevoUsuario.roles, role]
            });
        }
    };

    const handleEdit = (usuario: Usuario) => {
        if (!canManageUsers) return;
        setEditingId(usuario.id);
        setNuevoUsuario({
            nombre: usuario.nombre,
            tag: usuario.tag || '',
            nombre_creditos: usuario.nombre_creditos || usuario.nombre || '',
            roles: usuario.roles || [],
            grupo_id: usuario.grupo_id ? usuario.grupo_id.toString() : ''
        });
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setNuevoUsuario({ nombre: '', tag: '', nombre_creditos: '', roles: [], grupo_id: '' });
    };



    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canManageUsers) return;
        if (!nuevoUsuario.nombre) return;

        try {
            const url = editingId ? `/api/usuarios/${editingId}` : '/api/usuarios';
            const method = editingId ? 'PATCH' : 'POST';
            const payload = {
                ...nuevoUsuario,
                grupo_id: isLeader ? Number(user?.grupo_id || 0) : (nuevoUsuario.grupo_id ? Number(nuevoUsuario.grupo_id) : undefined),
            };

            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await res.json().catch(() => ({}));

            if (res.ok) {
                setNuevoUsuario({ nombre: '', tag: '', nombre_creditos: '', roles: [], grupo_id: '' });
                setEditingId(null);
                fetchUsuarios();
                showToast(editingId ? 'Usuario actualizado correctamente' : 'Usuario creado correctamente', 'success');
                return;
            }

            showToast(data?.error || 'No se pudo guardar el usuario', 'error');
        } catch (err) {
            console.error(err);
            showToast('Error al guardar usuario', 'error');
        }
    };

    const handleDeleteClick = (usuario: Usuario) => {
        if (!canManageUsers) return;
        setUserToDelete(usuario);
        setShowDeleteModal(true);
    };

    const handleConfirmDelete = async () => {
        if (!userToDelete) return;

        try {
            const res = await fetch(`/api/usuarios/${userToDelete.id}`, {
                method: 'DELETE',
            });

            if (res.ok) {
                showToast('Usuario eliminado correctamente', 'success');
                fetchUsuarios();
            } else {
                showToast('Error al eliminar usuario', 'error');
            }
        } catch (error) {
            console.error(error);
            showToast('Error al eliminar usuario', 'error');
        } finally {
            setShowDeleteModal(false);
            setUserToDelete(null);
        }
    };

    // Password Reset
    const [userToReset, setUserToReset] = useState<Usuario | null>(null);
    const [showResetModal, setShowResetModal] = useState(false);

    const handleResetClick = (usuario: Usuario) => {
        if (!canManageUsers) return;
        setUserToReset(usuario);
        setShowResetModal(true);
    };

    const handleConfirmReset = async () => {
        if (!userToReset) return;
        try {
            const res = await fetch(`/api/usuarios/${userToReset.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: '123456' }),
            });

            if (res.ok) {
                showToast(`Contraseña de ${userToReset.nombre} restablecida a '123456'`, 'success');
            } else {
                showToast('Error al restablecer contraseña', 'error');
            }
        } catch (error) {
            console.error(error);
            showToast('Error al restablecer contraseña', 'error');
        } finally {
            setShowResetModal(false);
            setUserToReset(null);
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-background-dark overflow-hidden">
            {/* Header ... (unchanged) */}
            <header className="h-20 bg-surface-dark border-b border-gray-800 hidden md:flex items-center justify-between px-6 lg:px-8 z-10 sticky top-0 shrink-0">
                <div className="flex items-center gap-4">
                    <h1 className="font-display font-bold text-2xl lg:text-3xl uppercase tracking-wider text-white">
                        <span className="text-primary">Staff</span>
                    </h1>
                    <div className="hidden md:flex items-center bg-surface-darker rounded-lg px-3 py-2 w-64 border border-gray-700 focus-within:border-primary transition-colors">
                        <span className="material-icons-round text-gray-400 text-xl mr-2">search</span>
                        <input
                            className="bg-transparent border-none text-sm w-full focus:outline-none p-0 text-white placeholder-gray-400"
                            placeholder="Buscar miembro..."
                            type="text"
                        />
                    </div>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 lg:p-8 pb-32 md:pb-8">
                <div className="max-w-6xl mx-auto">

                    {isAdmin && (
                        <div className="flex justify-end mb-6">
                            <button
                                onClick={() => setShowGrupoModal(true)}
                                className="bg-surface-dark border border-gray-700 hover:border-primary text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-all shadow-lg"
                            >
                                <span className="material-icons-round text-primary">group_add</span>
                                Crear Nuevo Grupo
                            </button>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
                        {/* Stats Cards */}
                        <div className="bg-surface-dark p-6 rounded-xl border border-gray-800 shadow-lg">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs font-bold text-muted-dark uppercase tracking-wider">Total Staff</p>
                                    <h3 className="text-3xl font-bold text-white mt-1">{usuarios.length}</h3>
                                </div>
                                <div className="w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center">
                                    <span className="material-icons-round text-2xl text-primary">group</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className={`grid grid-cols-1 ${canManageUsers ? 'lg:grid-cols-3' : 'lg:grid-cols-1'} gap-8`}>
                        {canManageUsers && (
                            <div className="bg-surface-dark p-6 rounded-xl border border-gray-800 shadow-lg h-fit">
                                <h3 className="font-display font-bold text-xl text-white mb-6 flex items-center gap-2">
                                    <span className="material-icons-round text-primary">{editingId ? 'edit' : 'person_add'}</span>
                                    {editingId ? 'Editar Miembro' : 'Agregar Miembro'}
                                </h3>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Nombre / Nickname</label>
                                        <input
                                            type="text"
                                            value={nuevoUsuario.nombre}
                                            onChange={e => setNuevoUsuario({ ...nuevoUsuario, nombre: e.target.value })}
                                            className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-primary transition-colors"
                                            placeholder="Ej. TebanLuc"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Tag (unico)</label>
                                        <input
                                            type="text"
                                            value={nuevoUsuario.tag}
                                            onChange={e => setNuevoUsuario({ ...nuevoUsuario, tag: e.target.value })}
                                            className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-primary transition-colors"
                                            placeholder="Ej. tebanluc"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Nombre en Creditos</label>
                                        <input
                                            type="text"
                                            value={nuevoUsuario.nombre_creditos}
                                            onChange={e => setNuevoUsuario({ ...nuevoUsuario, nombre_creditos: e.target.value })}
                                            className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-primary transition-colors"
                                            placeholder="Ej. Manolo"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Grupo</label>
                                        {isLeader && !isAdmin ? (
                                            <div className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-2.5 text-white">
                                                {String(user?.grupo_nombre || 'Sin Grupo').toUpperCase()}
                                            </div>
                                        ) : (
                                            <select
                                                value={nuevoUsuario.grupo_id}
                                                onChange={e => setNuevoUsuario({ ...nuevoUsuario, grupo_id: e.target.value })}
                                                className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-primary transition-colors appearance-none"
                                                required
                                            >
                                                <option value="">Seleccionar Grupo...</option>
                                                {grupos.map(grupo => (
                                                    <option key={grupo.id} value={grupo.id}>{grupo.nombre}</option>
                                                ))}
                                            </select>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Roles</label>
                                        <div className="flex flex-wrap gap-2">
                                            {assignableRoles.map(role => (
                                                <button
                                                    key={role}
                                                    type="button"
                                                    onClick={() => toggleRole(role)}
                                                    className={`text-xs px-3 py-1.5 rounded-full border transition-all flex items-center gap-1 ${nuevoUsuario.roles.includes(role)
                                                        ? 'bg-primary/20 border-primary text-primary'
                                                        : 'bg-background-dark border-gray-700 text-gray-400 hover:border-gray-500'
                                                        }`}
                                                >
                                                    {role}
                                                    {nuevoUsuario.roles.includes(role) && <Check size={12} />}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        {editingId && (
                                            <button
                                                type="button"
                                                onClick={handleCancelEdit}
                                                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-lg shadow-lg transition-all"
                                            >
                                                CANCELAR
                                            </button>
                                        )}
                                        <button
                                            type="submit"
                                            className="flex-1 bg-primary hover:bg-primary-dark text-white font-bold py-3 rounded-lg shadow-lg shadow-primary/20 transition-all transform hover:scale-[1.02] flex items-center justify-center gap-2"
                                        >
                                            {editingId ? <span className="material-icons-round">save</span> : <Plus size={18} />}
                                            {editingId ? 'ACTUALIZAR' : 'AGREGAR'}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        )}

                        {/* Lista */}
                        <div className={`${canManageUsers ? 'lg:col-span-2' : ''} bg-surface-dark rounded-xl border border-gray-800 shadow-lg overflow-hidden`}>
                            <div className="p-6 border-b border-gray-800">
                                <h3 className="font-display font-bold text-xl text-white flex items-center gap-2">
                                    <span className="material-icons-round text-success">group</span>
                                    {isLeader && !isAdmin ? 'Mi Staff (Grupo)' : 'Lista de Miembros'}
                                </h3>
                            </div>
                            <div className="max-h-[70vh] overflow-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-surface-darker text-muted-dark uppercase text-xs font-bold tracking-wider sticky top-0 z-10">
                                        <tr>
                                            <th className="px-6 py-4">ID</th>
                                            <th className="px-6 py-4">Nombre</th>
                                            <th className="px-6 py-4">Tag</th>
                                            <th className="px-6 py-4">Creditos</th>
                                            <th className="px-6 py-4">Grupo</th>
                                            <th className="px-6 py-4">Roles</th>
                                            {canManageUsers && <th className="px-6 py-4">Estado</th>}
                                            {isAdmin && <th className="px-6 py-4 text-right">Fecha Registro</th>}
                                            {canManageUsers && <th className="px-6 py-4 text-right sticky right-0 bg-surface-darker">Acciones</th>}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800">
                                        {loading ? (
                                            [...Array(5)].map((_, i) => (
                                                <tr key={i} className="animate-pulse">
                                                    <td className="px-6 py-4"><div className="h-4 bg-gray-800/50 rounded w-8"></div></td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-full bg-gray-800/50"></div>
                                                            <div className="h-4 bg-gray-800/50 rounded w-24"></div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4"><div className="h-4 bg-gray-800/50 rounded w-20"></div></td>
                                                    <td className="px-6 py-4"><div className="h-4 bg-gray-800/50 rounded w-16"></div></td>
                                                    {canManageUsers && <td className="px-6 py-4 text-right"><div className="h-4 bg-gray-800/50 rounded w-16 ml-auto"></div></td>}
                                                </tr>
                                            ))
                                        ) : usuarios.map(usuario => (
                                            <tr key={usuario.id} className={`hover:bg-white/5 transition-colors ${usuario.activo === 0 ? 'opacity-50 grayscale' : ''}`}>
                                                <td className="px-6 py-4 text-muted-dark font-mono">#{String(usuario.id).padStart(3, '0')}</td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
                                                            {usuario.nombre.charAt(0).toUpperCase()}
                                                        </div>
                                                        <span className="font-medium text-white">{usuario.nombre}</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="text-xs text-primary font-mono bg-primary/10 px-2 py-1 rounded border border-primary/30">
                                                        @{String(usuario.tag || '').trim() || '-'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="text-sm text-gray-200">
                                                        {String(usuario.nombre_creditos || usuario.nombre || '-')}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                        <span className="text-xs text-gray-400 font-medium bg-surface-darker px-2 py-1 rounded border border-gray-700 whitespace-nowrap">
                                                        {String(usuario.grupo_nombre || 'Sin Grupo').toUpperCase()}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {usuario.roles && usuario.roles.length > 0 ? (
                                                            usuario.roles.map((role, idx) => (
                                                                <span key={idx} className={`text-[10px] px-2 py-0.5 rounded-full border ${role === 'Administrador' ? 'bg-red-500/10 border-red-500/30 text-red-500' :
                                                                    role === 'Lider de Grupo' ? 'bg-purple-500/10 border-purple-500/30 text-purple-500' :
                                                                        'bg-gray-700/30 border-gray-600 text-gray-300'
                                                                    }`}>
                                                                    {role}
                                                                </span>
                                                            ))
                                                        ) : (
                                                            <span className="text-xs text-muted-dark italic">Sin roles</span>
                                                        )}
                                                    </div>
                                                </td>
                                                {canManageUsers && (
                                                    <td className="px-6 py-4">
                                                        <button
                                                            onClick={() => toggleStatus(usuario.id, usuario.activo)}
                                                            className={`text-xs font-bold px-3 py-1 rounded-full border transition-all ${usuario.activo === 1
                                                                ? 'bg-green-500/10 border-green-500/30 text-green-500 hover:bg-red-500/20 hover:border-red-500/50 hover:text-red-500'
                                                                : 'bg-red-500/10 border-red-500/30 text-red-500 hover:bg-green-500/20 hover:border-green-500/50 hover:text-green-500'
                                                                }`}
                                                        >
                                                            {usuario.activo === 1 ? 'Activo' : 'Inactivo'}
                                                        </button>
                                                    </td>
                                                )}
                                                {isAdmin && (
                                                    <td className="px-6 py-4 text-right text-muted-dark text-sm">
                                                        {new Date(usuario.creado_en).toLocaleDateString()}
                                                    </td>
                                                )}
                                                {canManageUsers && (
                                                    <td className="px-6 py-4 text-right sticky right-0 bg-surface-dark">
                                                        <div className="flex items-center justify-end gap-2 min-w-[180px]">
                                                            {/* Leader Action: Assign Task */}
                                                            {true && (
                                                                <Link
                                                                    href={`/asignaciones/nueva?usuario_id=${usuario.id}`}
                                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-darker hover:bg-primary/10 text-gray-300 hover:text-primary border border-gray-700 hover:border-primary/40 transition-colors text-xs font-bold"
                                                                    title="Asignar"
                                                                >
                                                                    <span className="material-icons-round text-sm">assignment</span>
                                                                    <span>Asignar</span>
                                                                </Link>
                                                            )}

                                                            {/* Admin Actions: Edit & Delete */}
                                                            {true && (
                                                                <>
                                                                    <button
                                                                        onClick={() => handleEdit(usuario)}
                                                                        className="w-8 h-8 rounded-full bg-gray-800 hover:bg-primary/20 text-gray-400 hover:text-primary flex items-center justify-center transition-colors"
                                                                        title="Editar roles"
                                                                    >
                                                                        <span className="material-icons-round text-sm">edit</span>
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDeleteClick(usuario)}
                                                                        className="w-8 h-8 rounded-full bg-gray-800 hover:bg-red-500/20 text-gray-400 hover:text-red-500 flex items-center justify-center transition-colors"
                                                                        title="Eliminar usuario"
                                                                    >
                                                                        <Trash2 size={16} />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleResetClick(usuario)}
                                                                        className="w-8 h-8 rounded-full bg-gray-800 hover:bg-yellow-500/20 text-gray-400 hover:text-yellow-500 flex items-center justify-center transition-colors"
                                                                        title="Restablecer Contraseña"
                                                                    >
                                                                        <span className="material-icons-round text-sm">key</span>
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                        {!loading && usuarios.length === 0 && (
                                            <tr>
                                                <td colSpan={isAdmin ? 9 : (canManageUsers ? 8 : 6)} className="px-6 py-12 text-center text-muted-dark">
                                                    <div className="flex flex-col items-center gap-2">
                                                        <span className="material-icons-round text-4xl text-gray-700">person_off</span>
                                                        <p>No hay usuarios registrados aún.</p>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {/* Modal Crear Grupo */}
            {showGrupoModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-surface-dark w-full max-w-md rounded-xl border border-gray-800 shadow-2xl p-6">
                        <h3 className="text-xl font-bold text-white mb-4">Crear Nuevo Grupo</h3>
                        <form onSubmit={handleCreateGrupo}>
                            <input
                                type="text"
                                className="w-full bg-background-dark border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary mb-6"
                                placeholder="Nombre del Grupo (ej. Grupo A-2)"
                                value={nuevoGrupo}
                                onChange={e => setNuevoGrupo(e.target.value)}
                                required
                            />
                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowGrupoModal(false)}
                                    className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-lg transition-colors"
                                >
                                    CANCELAR
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 bg-primary hover:bg-primary-dark text-white font-bold py-3 rounded-lg transition-colors"
                                >
                                    CREAR
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={showDeleteModal}
                title="Eliminar Usuario"
                message={`¿Estás seguro de que deseas eliminar al usuario "${userToDelete?.nombre}"? Esta acción eliminará todas su asignaciones y reportes.`}
                onConfirm={handleConfirmDelete}
                onCancel={() => setShowDeleteModal(false)}
                isDanger={true}
                confirmText="Eliminar"
            />

            <ConfirmModal
                isOpen={showResetModal}
                title="Restablecer Contraseña"
                message={`¿Estás seguro de que deseas restablecer la contraseña de "${userToReset?.nombre}" a "123456"?`}
                onConfirm={handleConfirmReset}
                onCancel={() => setShowResetModal(false)}
                confirmText="Restablecer"
            />
        </div>
    );
}
