// 🌐 API SERVICE
// Este archivo es 100% reutilizable en React Native
// Solo cambia la baseURL según el entorno

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

// Tipos
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  success: boolean;
}

export interface Usuario {
  id: number;
  nombre: string;
  discord_username: string | null;
  creado_en: string;
}

export interface Proyecto {
  id: number;
  titulo: string;
  tipo: string;
  genero: string;
  capitulos_actuales: number;
  capitulos_totales: number | null;
  estado: string;
  ultima_actualizacion: string;
  imagen_url: string;
  frecuencia: string;
}

export interface Asignacion {
  id: number;
  usuario_id: number;
  rol: string;
  descripcion: string;
  estado: string;
  asignado_en: string;
  completado_en: string | null;
  informe: string | null;
  drive_url: string | null;
  usuario_nombre: string;
  discord_username: string | null;
}

// Helper para hacer requests
async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// ===== USUARIOS =====
export const usuariosAPI = {
  getAll: () => fetchAPI<Usuario[]>('/usuarios'),

  create: (data: Omit<Usuario, 'id' | 'creado_en'>) =>
    fetchAPI<Usuario>('/usuarios', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// ===== PROYECTOS =====
export const proyectosAPI = {
  getAll: () => fetchAPI<Proyecto[]>('/proyectos'),

  getById: (id: number) => fetchAPI<Proyecto>(`/proyectos/${id}`),

  create: (data: Omit<Proyecto, 'id' | 'ultima_actualizacion'>) =>
    fetchAPI<Proyecto>('/proyectos', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: number, data: Partial<Proyecto>) =>
    fetchAPI<Proyecto>(`/proyectos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: number) =>
    fetchAPI<{ message: string }>(`/proyectos/${id}`, {
      method: 'DELETE',
    }),
};

// ===== ASIGNACIONES =====
export const asignacionesAPI = {
  getAll: () => fetchAPI<Asignacion[]>('/asignaciones'),

  getById: (id: number) => fetchAPI<Asignacion>(`/asignaciones/${id}`),

  create: (data: Omit<Asignacion, 'id' | 'asignado_en' | 'completado_en' | 'usuario_nombre' | 'discord_username'>) =>
    fetchAPI<Asignacion>('/asignaciones', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateEstado: (id: number, estado: string, informe?: string) =>
    fetchAPI<Asignacion>(`/asignaciones/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado, informe }),
    }),

  updateDriveUrl: (id: number, drive_url: string) =>
    fetchAPI<Asignacion>(`/asignaciones/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ drive_url }),
    }),

  delete: (id: number) =>
    fetchAPI<{ message: string }>(`/asignaciones/${id}`, {
      method: 'DELETE',
    }),

  addInforme: (id: number, mensaje: string) =>
    fetchAPI<any>(`/asignaciones/${id}/informes`, {
      method: 'POST',
      body: JSON.stringify({ mensaje }),
    }),
};

// ===== ESTADÍSTICAS =====
export const estadisticasAPI = {
  get: () => fetchAPI<any>('/estadisticas'),
};

// Export todo junto
export const api = {
  usuarios: usuariosAPI,
  proyectos: proyectosAPI,
  asignaciones: asignacionesAPI,
  estadisticas: estadisticasAPI,
};

export default api;
