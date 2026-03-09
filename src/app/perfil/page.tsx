'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useUser } from '@/context/UserContext';
import { useToast } from '@/context/ToastContext';

interface HistoryItem {
    id: number;
    fecha: string;
    proyecto?: string;
    proyecto_titulo?: string;
    capitulo: number;
    rol: string;
    usuario: string;
}

export default function PerfilPage() {
    const { user, refreshUser } = useUser();
    const { showToast } = useToast();

    const [historial, setHistorial] = useState<HistoryItem[]>([]);
    const [stats, setStats] = useState({
        completadas: 0,
        enProceso: 0,
        proyectos: 0
    });
    const [isLoading, setIsLoading] = useState(true);

    const [formData, setFormData] = useState({
        nombre: '',
        email: '',
        bio: '',
        password: '',
        confirmPassword: ''
    });

    const [showAvatarModal, setShowAvatarModal] = useState(false);
    const [avatarUrl, setAvatarUrl] = useState('');

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

    useEffect(() => {
        if (user) {
            setFormData({
                nombre: user.nombre,
                email: '',
                bio: '',
                password: '',
                confirmPassword: ''
            });
            setAvatarUrl(user.avatar_url || '');
            fetchData();
        }
    }, [user]);

    const fetchData = async () => {
        if (!user) return;
        try {
            const resHist = await fetch(`/api/historial?usuario_id=${user.id}`);
            const dataHist = await resHist.json();
            setHistorial(dataHist);

            const resAsig = await fetch('/api/asignaciones');
            const dataAsig = await resAsig.json();
            const myAsigs = (Array.isArray(dataAsig) ? dataAsig : []).filter((a: any) => Number(a.usuario_id) === Number(user.id));
            const enProceso = myAsigs.filter((a: any) => a.estado === 'En Proceso').length;
            const uniqueProjects = new Set(myAsigs.map((a: any) => a.proyecto_id)).size;

            setStats({
                completadas: dataHist.length,
                enProceso: enProceso,
                proyectos: uniqueProjects
            });
        } catch (error) {
            console.error('Error fetching profile data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpdateAvatar = async () => {
        if (!user) return;
        try {
            const res = await fetch(`/api/usuarios/${user.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ avatar_url: avatarUrl }),
            });
            if (res.ok) {
                await refreshUser();
                setShowAvatarModal(false);
                showToast('Foto de perfil actualizada correctamente.', 'success');
            }
        } catch (error) {
            console.error(error);
            showToast('Error al actualizar la foto de perfil', 'error');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (formData.password && formData.password !== formData.confirmPassword) {
            showToast('Las contraseñas no coinciden', 'error');
            return;
        }

        try {
            const body: any = {
                nombre: formData.nombre,
                // email: formData.email, // Backend doesn't support email yet?
                // bio: formData.bio // Backend doesn't support bio yet?
            };

            if (formData.password) {
                body.password = formData.password;
            }

            const res = await fetch(`/api/usuarios/${user?.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (res.ok) {
                showToast('Perfil actualizado correctamente', 'success');
                setFormData(prev => ({ ...prev, password: '', confirmPassword: '' }));
                await refreshUser();
            } else {
                showToast('Error al actualizar perfil', 'error');
            }
        } catch (error) {
            console.error(error);
            showToast('Error al actualizar perfil', 'error');
        }
    };

    if (!user) return <div className="p-8 text-white">Cargando perfil...</div>;

    const statCards = [
        { label: 'Tareas Completadas', value: stats.completadas, icon: 'check_circle', color: 'emerald' },
        { label: 'En Proceso', value: stats.enProceso, icon: 'sync', color: 'blue' },
        { label: 'Proyectos Activos', value: stats.proyectos, icon: 'library_books', color: 'purple' },
    ];

    return (
        <div className="flex-1 flex flex-col h-full bg-background-dark overflow-hidden">
            {/* Header - Desktop */}
            <header className="h-20 bg-gradient-to-r from-surface-dark to-surface-darker border-b border-gray-800/50 hidden md:flex items-center justify-between px-6 lg:px-8 z-10 sticky top-0 shrink-0 backdrop-blur-lg">
                <div className="flex items-center gap-4">
                    <Link href="/" className="text-gray-400 hover:text-primary transition-colors">
                        <span className="material-icons-round">arrow_back</span>
                    </Link>
                    <h1 className="font-display font-bold text-2xl lg:text-3xl uppercase tracking-wider text-white">
                        <span className="text-primary">Mi Perfil</span>
                    </h1>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 pb-32 md:pb-8">
                <div className="max-w-5xl mx-auto space-y-6">

                    {/* Profile Header Card */}
                    <div className="relative bg-gradient-to-br from-surface-dark via-surface-dark to-surface-darker rounded-2xl border border-gray-800/50 shadow-2xl overflow-hidden">
                        {/* Cover */}
                        <div className="h-32 md:h-40 bg-gradient-to-br from-primary/20 via-blue-600/20 to-purple-600/20 relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent animate-glow-pulse"></div>
                            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS1vcGFjaXR5PSIwLjAzIiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-30"></div>
                        </div>

                        {/* Profile Content */}
                        <div className="px-6 pb-6 relative">
                            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 -mt-16 md:-mt-20">
                                {/* Avatar & Info */}
                                <div className="flex flex-col md:flex-row items-center md:items-end gap-4">
                                    {/* Avatar */}
                                    <div className="relative group">
                                        <div className="absolute inset-0 bg-gradient-to-br from-primary to-blue-600 rounded-full blur-lg opacity-50 group-hover:opacity-75 transition-opacity"></div>
                                        <div className="relative w-32 h-32 md:w-40 md:h-40 rounded-full border-4 border-surface-dark shadow-2xl bg-surface-dark flex items-center justify-center overflow-hidden">
                                            {user.avatar_url ? (
                                                <img src={user.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="text-4xl font-bold text-primary">
                                                    {user.nombre.charAt(0).toUpperCase()}
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => setShowAvatarModal(true)}
                                            className="absolute bottom-2 right-2 bg-gradient-to-br from-primary to-blue-600 hover:from-primary-dark hover:to-blue-700 text-white rounded-full p-3 shadow-glow shadow-primary/50 transition-all hover:scale-110"
                                        >
                                            <span className="material-icons-round text-lg">link</span>
                                        </button>
                                        <div className="absolute top-2 right-2 w-6 h-6 bg-emerald-500 rounded-full border-4 border-surface-dark shadow-glow shadow-emerald-500/50"></div>
                                    </div>

                                    {/* Name & Role */}
                                    <div className="text-center md:text-left mb-4 md:mb-0">
                                        <h2 className="text-3xl font-display font-bold text-white mb-1 flex items-center gap-2 justify-center md:justify-start">
                                            {user.nombre}
                                            {user.isAdmin && <span className="material-icons-round text-primary text-2xl">verified</span>}
                                        </h2>
                                        <p className="text-sm text-muted-dark mb-2 flex items-center gap-2 justify-center md:justify-start">
                                            <span className="w-2 h-2 rounded-full bg-primary"></span>
                                            {user.roles && user.roles.join(' / ')}
                                        </p>
                                    </div>
                                </div>

                                {/* Action Buttons - Removed Config Button */}
                                <div className="flex gap-2 justify-center md:justify-end w-full md:w-auto h-10">
                                    {/* Placeholder to keep layout if needed, or just remove */}
                                </div>
                            </div>

                            {/* Bio */}
                            {formData.bio && (
                                <div className="mt-6 p-4 bg-surface-darker/50 rounded-xl border border-gray-800/50">
                                    <p className="text-sm text-gray-300 leading-relaxed">{formData.bio}</p>
                                </div>
                            )}

                            {/* Default Password Alert */}
                            {user.isDefaultPassword && (
                                <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl flex items-start gap-3">
                                    <span className="material-icons-round text-yellow-500 mt-0.5">warning</span>
                                    <div>
                                        <h4 className="text-yellow-500 font-bold text-sm mb-1">Tu seguridad es importante</h4>
                                        <p className="text-xs text-yellow-500/80">
                                            Estás usando la contraseña por defecto. Te recomendamos cambiarla lo antes posible.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Stats Cards */}
                    <div className="grid grid-cols-3 gap-3 md:gap-4">
                        {statCards.map((stat, index) => (
                            <div
                                key={stat.label}
                                className="group bg-gradient-to-br from-surface-dark to-surface-darker p-4 md:p-5 rounded-xl border border-gray-800 hover:border-gray-700 shadow-card hover:shadow-card-hover transition-all duration-300 relative overflow-hidden animate-fade-in"
                                style={{ animationDelay: `${index * 100}ms` }}
                            >
                                <div className={`absolute inset-0 bg-gradient-to-br from-${stat.color}-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity`}></div>
                                <div className="relative z-10 text-center">
                                    <div className={`inline-flex bg-${stat.color}-500/20 p-2 md:p-2.5 rounded-lg mb-2 md:mb-3`}>
                                        <span className={`material-icons-round text-xl md:text-2xl text-${stat.color}-500`}>
                                            {stat.icon}
                                        </span>
                                    </div>
                                    <h3 className="text-2xl md:text-3xl font-display font-bold text-white mb-1">{stat.value}</h3>
                                    <p className="text-[10px] md:text-xs text-muted-dark font-medium">{stat.label}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Edit Form */}
                    <div className="bg-gradient-to-br from-surface-dark to-surface-darker p-6 rounded-2xl border border-gray-800/50 shadow-xl">
                        <h3 className="font-display font-bold text-xl text-white mb-6 flex items-center gap-2">
                            <div className="bg-primary/20 p-2 rounded-lg">
                                <span className="material-icons-round text-primary">edit</span>
                            </div>
                            Editar Información
                        </h3>

                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">
                                        Nombre / Nickname
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.nombre}
                                        onChange={e => setFormData({ ...formData, nombre: e.target.value })}
                                        className="w-full bg-background-dark border border-gray-700 focus:border-primary rounded-lg px-4 py-3 text-white focus:outline-none transition-colors"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">
                                        Rol
                                    </label>
                                    <input
                                        type="text"
                                        value={user.roles ? user.roles.join(', ') : ''}
                                        disabled
                                        className="w-full bg-background-dark border border-gray-800 text-gray-400 rounded-lg px-4 py-3 focus:outline-none cursor-not-allowed"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">
                                        Email
                                    </label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                                        className="w-full bg-background-dark border border-gray-700 focus:border-primary rounded-lg px-4 py-3 text-white focus:outline-none transition-colors"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">
                                    Biografía
                                </label>
                                <textarea
                                    value={formData.bio}
                                    onChange={e => setFormData({ ...formData, bio: e.target.value })}
                                    rows={3}
                                    className="w-full bg-background-dark border border-gray-700 focus:border-primary rounded-lg px-4 py-3 text-white focus:outline-none transition-colors resize-none"
                                    placeholder="Cuéntanos sobre ti..."
                                />
                            </div>

                            <div className="border-t border-gray-800/50 pt-5 mt-2">
                                <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                                    <span className="material-icons-round text-primary text-base">lock</span>
                                    Cambiar Contraseña
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div>
                                        <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">
                                            Nueva Contraseña
                                        </label>
                                        <input
                                            type="password"
                                            value={formData.password}
                                            onChange={e => setFormData({ ...formData, password: e.target.value })}
                                            className="w-full bg-background-dark border border-gray-700 focus:border-primary rounded-lg px-4 py-3 text-white focus:outline-none transition-colors"
                                            placeholder="Dejar en blanco para mantener actual"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">
                                            Confirmar Contraseña
                                        </label>
                                        <input
                                            type="password"
                                            value={formData.confirmPassword}
                                            onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })}
                                            className="w-full bg-background-dark border border-gray-700 focus:border-primary rounded-lg px-4 py-3 text-white focus:outline-none transition-colors"
                                            placeholder="Repite la nueva contraseña"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="pt-2">
                                <button
                                    type="submit"
                                    className="w-full bg-gradient-to-r from-primary to-blue-600 hover:from-primary-dark hover:to-blue-700 text-white font-bold py-3.5 rounded-lg shadow-glow shadow-primary/30 transition-all transform hover:scale-[1.02] active:scale-100 flex items-center justify-center gap-2"
                                >
                                    <span className="material-icons-round text-lg">save</span>
                                    GUARDAR CAMBIOS
                                </button>
                            </div>
                        </form>
                    </div>

                    {/* History Section */}
                    <div className="bg-gradient-to-br from-surface-dark to-surface-darker rounded-2xl border border-gray-800/50 shadow-xl overflow-hidden">
                        <div className="p-6 border-b border-gray-800/50">
                            <h3 className="font-display font-bold text-xl text-white flex items-center gap-2">
                                <div className="bg-purple-500/20 p-2 rounded-lg">
                                    <span className="material-icons-round text-purple-500">history</span>
                                </div>
                                Historial de Trabajo
                            </h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-surface-darker text-muted-dark uppercase text-xs font-bold tracking-wider">
                                    <tr>
                                        <th className="px-6 py-4">Proyecto</th>
                                        <th className="px-6 py-4">Rol</th>
                                        <th className="px-6 py-4 text-right">Fecha</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-800/50">
                                    {historial.length > 0 ? (
                                        historial.slice(0, 10).map((item) => (
                                            <tr key={item.id} className="hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-4">
                                                    <span className="font-bold text-white block">{item.proyecto_titulo || item.proyecto || 'Sin proyecto'}</span>
                                                    {item.capitulo && <span className="text-xs text-primary">Capítulo {item.capitulo}</span>}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`text-xs px-2 py-1 rounded border font-bold ${getRoleClasses(item.rol)}`}>
                                                        {item.rol}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right text-muted-dark text-sm">
                                                    {item.fecha ? new Date(item.fecha).toLocaleDateString() : '-'}
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={3} className="px-6 py-8 text-center text-muted-dark">
                                                No hay actividad reciente registrada.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            {/* Avatar Modal */}
            {showAvatarModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 animate-fade-in">
                    <div className="bg-surface-dark rounded-2xl w-full max-w-md border border-gray-800 shadow-2xl overflow-hidden animate-slide-up">
                        <div className="p-6 border-b border-gray-800">
                            <h3 className="font-display font-bold text-xl text-white">Actualizar Foto</h3>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">
                                    URL de la imagen
                                </label>
                                <input
                                    type="url"
                                    value={avatarUrl}
                                    onChange={e => setAvatarUrl(e.target.value)}
                                    placeholder="https://ejemplo.com/imagen.jpg"
                                    className="w-full bg-background-dark border border-gray-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-primary transition-colors"
                                />
                            </div>
                            {avatarUrl && (
                                <div className="flex justify-center">
                                    <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-primary">
                                        <img src={avatarUrl} alt="Preview" className="w-full h-full object-cover" onError={(e: any) => e.target.style.display = 'none'} />
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="p-6 pt-0 flex gap-3">
                            <button
                                onClick={() => setShowAvatarModal(false)}
                                className="flex-1 px-4 py-3 rounded-xl font-bold text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleUpdateAvatar}
                                className="flex-1 bg-primary hover:bg-primary-dark text-white px-4 py-3 rounded-xl font-bold shadow-lg shadow-primary/20 transition-all"
                            >
                                Guardar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
