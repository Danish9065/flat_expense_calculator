import React, { useState, useEffect } from 'react';
import insforge from '../lib/db';
import { dbUpdate } from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { User, Loader2, Image as ImageIcon, Save, LogOut } from 'lucide-react';

export default function Settings() {
    const { user, signOut } = useAuth();
    const { success, error: showError } = useToast();

    const [fullName, setFullName] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [currency, setCurrency] = useState('₹');
    const [profileLoading, setProfileLoading] = useState(false);

    // Password updates removed: unsupported by lightweight auth SDK.

    useEffect(() => {
        if (user) {
            setFullName(user.full_name || '');
            setAvatarUrl(user.avatar_url || '');
            setCurrency(user.currency || '₹');
        }
    }, [user]);

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        setProfileLoading(true);

        try {
            let finalAvatarUrl = avatarUrl;

            if (avatarFile) {
                // Delete old avatar if exists and it's from our storage
                if (avatarUrl && avatarUrl.includes('/avatars/')) {
                    const urlParts = avatarUrl.split('/');
                    const fileName = decodeURIComponent(urlParts[urlParts.length - 1]);
                    if (fileName) {
                        try {
                            await insforge.storage.from('avatars').remove(fileName);
                        } catch (err) {
                            console.log('Skipping removal of old avatar', err);
                        }
                    }
                }

                const { data, error: uploadErr } = await insforge.storage
                    .from('avatars')
                    .uploadAuto(avatarFile);

                if (uploadErr) {
                    const errStr = uploadErr.message?.toLowerCase() || '';
                    if (errStr.includes('already exists') || errStr.includes('duplicate')) {
                        // The file is already safely uploaded natively
                        finalAvatarUrl = avatarUrl;
                    } else {
                        console.error('Storage error details:', uploadErr);
                        throw new Error(uploadErr.message || 'Failed to upload avatar');
                    }
                } else if (data?.url) {
                    finalAvatarUrl = data.url;
                }
            }

            await dbUpdate('users', `id=eq.${user.id}`, {
                full_name: fullName,
                avatar_url: finalAvatarUrl,
                currency: currency
            });

            // Optionally update auth user meta data as well
            try {
                await insforge.auth.setProfile({
                    name: fullName,
                    avatar_url: finalAvatarUrl
                });
            } catch (err) {
                console.log('Skipping legacy auth profile save', err);
            }

            success('Profile updated successfully!');

            // Auto reload to refresh auth context user details
            setTimeout(() => window.location.reload(), 1000);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            showError(err.message || 'Error updating profile');
        } finally {
            setProfileLoading(false);
        }
    };



    return (
        <div className="app-section pb-28 min-h-screen space-y-6">
            <div className="text-center mb-8">
                <p className="app-label mb-3">Account preferences</p>
                <h1 className="app-title">Settings</h1>
            </div>

            {/* Profile Section */}
            <div className="app-panel p-6 lg:p-8 max-w-2xl mx-auto">
                <h2 className="text-lg font-bold text-white mb-4 flex items-center">
                    <User className="w-5 h-5 mr-2 text-primary" />
                    Profile Details
                </h2>

                <form onSubmit={handleUpdateProfile} className="space-y-4">
                    <div>
                        <label className="app-label mb-2 block">Full Name</label>
                        <input
                            required
                            type="text"
                            value={fullName}
                            onChange={e => setFullName(e.target.value)}
                            className="dark-input block px-3 py-2 rounded-lg sm:text-sm"
                        />
                    </div>

                    <div>
                        <label className="app-label mb-2 block">Avatar Photo</label>
                        <div className="mt-1 flex justify-center px-6 py-4 border border-white/10 border-dashed rounded-xl hover:bg-white/[0.04] transition-colors">
                            <div className="space-y-1 text-center">
                                <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground" />
                                <div className="flex text-sm text-muted-foreground justify-center">
                                    <label className="relative cursor-pointer bg-transparent rounded-md font-medium text-primary hover:text-primary/80 focus-within:outline-none">
                                        <span>{avatarFile ? avatarFile.name : (avatarUrl ? 'Replace current avatar' : 'Upload a file')}</span>
                                        <input type="file" className="sr-only" accept="image/jpeg, image/png, image/webp" onChange={e => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                                if (file.size > 5 * 1024 * 1024) {
                                                    showError('File exceeds 5MB limit');
                                                    e.target.value = '';
                                                } else {
                                                    setAvatarFile(file);
                                                }
                                            } else {
                                                setAvatarFile(null);
                                            }
                                        }} />
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="app-label mb-2 block">Default Currency</label>
                        <select
                            value={currency}
                            onChange={e => setCurrency(e.target.value)}
                            className="dark-input block px-3 py-2 rounded-lg sm:text-sm"
                        >
                            <option value="₹">INR (₹)</option>
                            <option value="$">USD ($)</option>
                            <option value="€">EUR (€)</option>
                            <option value="£">GBP (£)</option>
                        </select>
                    </div>

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={profileLoading}
                            className="accent-button w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary focus:ring-offset-background"
                        >
                            {profileLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                            Save Profile
                        </button>
                    </div>
                </form>
            </div>



            {/* Logout */}
            <div className="pt-4 max-w-2xl mx-auto">
                <button
                    onClick={signOut}
                    className="w-full flex justify-center items-center py-3.5 px-4 rounded-xl text-sm font-bold text-primary bg-primary/10 hover:bg-primary/20 transition-colors border border-primary/20"
                >
                    <LogOut className="w-5 h-5 mr-2" />
                    Sign Out
                </button>
            </div>

        </div>
    );
}
