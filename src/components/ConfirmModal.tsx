'use client';

import React from 'react';

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    confirmText?: string;
    cancelText?: string;
    isDanger?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    isOpen,
    title,
    message,
    onConfirm,
    onCancel,
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    isDanger = false
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4 animate-fade-in">
            <div className="bg-surface-dark rounded-2xl w-full max-w-md border border-gray-800 shadow-2xl overflow-hidden animate-slide-up">
                <div className="p-6 border-b border-gray-800">
                    <h3 className="font-display font-bold text-xl text-white">{title}</h3>
                </div>
                <div className="p-6">
                    <p className="text-gray-300 text-sm leading-relaxed">{message}</p>
                </div>
                <div className="p-6 pt-0 flex gap-3">
                    <button
                        onClick={onCancel}
                        className="flex-1 px-4 py-3 rounded-xl font-bold text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 px-4 py-3 rounded-xl font-bold text-white shadow-lg transition-all
                            ${isDanger
                                ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20'
                                : 'bg-primary hover:bg-primary-dark shadow-primary/20'
                            }`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};
