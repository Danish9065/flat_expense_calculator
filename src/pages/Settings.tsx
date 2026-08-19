import { useState, useEffect, type FormEvent } from 'react';
import insforge from '../lib/db';
import { dbQuery, dbUpdate } from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { User, Loader2, Image as ImageIcon, Save, LogOut, MessageCircle, ShieldCheck, WalletCards } from 'lucide-react';
import { isValidUpiId, isValidWhatsAppNumber, normalizeUpiId, normalizeWhatsAppNumber } from '../lib/paymentLinks';
import { deleteStorageReference, safeStorageFileName, uploadPrivateFile } from '../lib/storage';

interface PaymentProfileRow {
    whatsapp_number?: string | null;
    upi_id?: string | null;
}

export default function Settings() {
    const { user, signOut } = useAuth();
    const { success, error: showError } = useToast();

    const [fullName, setFullName] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [currency, setCurrency] = useState('₹');
    const [whatsappNumber, setWhatsappNumber] = useState('');
    const [upiId, setUpiId] = useState('');
    const [profileLoading, setProfileLoading] = useState(false);

    // Password updates removed: unsupported by lightweight auth SDK.

    useEffect(() => {
        if (user) {
            setFullName(user.full_name || '');
            setAvatarUrl(user.avatar_url || '');
            setCurrency(user.currency || '₹');

            let active = true;
            void dbQuery('user_payment_profiles', `user_id=eq.${user.id}&select=whatsapp_number,upi_id`)
                .then((rows) => {
                    if (!active) return;
                    const paymentProfile = (rows as unknown as PaymentProfileRow[] | undefined)?.[0];
                    setWhatsappNumber(paymentProfile?.whatsapp_number || '');
                    setUpiId(paymentProfile?.upi_id || '');
                })
                .catch((error) => console.error('Could not load payment profile', error));
            return () => { active = false; };
        }
    }, [user]);

    const handleUpdateProfile = async (e: FormEvent) => {
        e.preventDefault();
        if (!user) return;
        if (whatsappNumber.trim() && !isValidWhatsAppNumber(whatsappNumber)) {
            showError('Enter your WhatsApp number with country code, for example 919876543210.');
            return;
        }
        if (upiId.trim() && !isValidUpiId(upiId)) {
            showError('Enter a valid UPI ID such as yourname@bank.');
            return;
        }
        setProfileLoading(true);

        try {
            let finalAvatarUrl = avatarUrl;

            if (avatarFile) {
                await deleteStorageReference(avatarUrl).catch((error) => {
                    console.warn('Could not remove the previous Supabase avatar', error);
                });
                const objectPath = `${user.id}/${crypto.randomUUID()}-${safeStorageFileName(avatarFile.name)}`;
                finalAvatarUrl = await uploadPrivateFile('avatars', objectPath, avatarFile);
            }

            await dbUpdate('users', `id=eq.${user.id}`, {
                full_name: fullName,
                avatar_url: finalAvatarUrl,
                currency: currency
            });

            const { error: paymentProfileError } = await insforge.database
                .from('user_payment_profiles')
                .upsert({
                    user_id: user.id,
                    whatsapp_number: whatsappNumber.trim() ? normalizeWhatsAppNumber(whatsappNumber) : null,
                    upi_id: upiId.trim() ? normalizeUpiId(upiId) : null,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'user_id' });
            if (paymentProfileError) throw new Error(paymentProfileError.message || 'Failed to save payment details');

            // Optionally update auth user meta data as well
            try {
                await insforge.auth.updateUser({
                    data: { full_name: fullName, avatar_url: finalAvatarUrl }
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
                <h1 className="app-title">Me</h1>
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

                    <div className="rounded-2xl border border-primary/20 bg-primary/[0.05] p-4 sm:p-5">
                        <div className="mb-4 flex items-start gap-3">
                            <div className="rounded-xl bg-primary/10 p-2"><WalletCards className="h-5 w-5 text-primary" /></div>
                            <div>
                                <h3 className="font-bold text-white">Payment & reminders</h3>
                                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Optional details used for UPI payment buttons and WhatsApp reminders.</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <label className="app-label mb-2 block" htmlFor="profile-whatsapp">WhatsApp number</label>
                                <div className="relative">
                                    <MessageCircle className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <input
                                        id="profile-whatsapp"
                                        type="tel"
                                        inputMode="tel"
                                        autoComplete="tel"
                                        value={whatsappNumber}
                                        onChange={(e) => setWhatsappNumber(e.target.value)}
                                        placeholder="919876543210"
                                        className="dark-input block rounded-lg py-2 pl-10 pr-3 text-sm"
                                    />
                                </div>
                                <p className={`mt-1 text-[11px] ${whatsappNumber.trim() && !isValidWhatsAppNumber(whatsappNumber) ? 'text-danger' : 'text-muted-foreground'}`}>Include the country code without a leading zero.</p>
                            </div>

                            <div>
                                <label className="app-label mb-2 block" htmlFor="profile-upi">UPI ID</label>
                                <div className="relative">
                                    <WalletCards className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <input
                                        id="profile-upi"
                                        type="text"
                                        inputMode="email"
                                        autoCapitalize="none"
                                        autoCorrect="off"
                                        value={upiId}
                                        onChange={(e) => setUpiId(e.target.value)}
                                        placeholder="yourname@bank"
                                        className="dark-input block rounded-lg py-2 pl-10 pr-3 text-sm"
                                    />
                                </div>
                                {upiId.trim() && !isValidUpiId(upiId) ? <p className="mt-1 text-[11px] text-danger">Enter a valid ID such as name@bank.</p> : null}
                            </div>
                        </div>

                        <div className="mt-4 flex items-start gap-2 rounded-xl bg-black/20 p-3 text-[11px] leading-relaxed text-muted-foreground">
                            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                            <span>These values are visible only to you and people who share an expense group with you. SplitMate never asks for or stores your UPI PIN.</span>
                        </div>
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
