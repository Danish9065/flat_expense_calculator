import { useState, useEffect, type FormEvent } from 'react';
import insforge from '../lib/db';
import { dbQuery, dbUpdate } from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { User, Loader2, Image as ImageIcon, Save, LogOut, MessageCircle, ShieldCheck, WalletCards, Pencil, CheckCircle2, X } from 'lucide-react';
import { isValidUpiId, normalizeUpiId } from '../lib/paymentLinks';
import { deleteStorageReference, safeStorageFileName, uploadPrivateFile } from '../lib/storage';
import CountryCodeSelect from '../components/CountryCodeSelect';
import SecureStorageImage from '../components/SecureStorageImage';
import imageCompression from 'browser-image-compression';
import {
    buildInternationalWhatsAppNumber,
    formatInternationalPhone,
    sanitizeLocalPhoneNumber,
    splitInternationalWhatsAppNumber,
} from '../lib/countryPhone';

interface PaymentProfileRow {
    whatsapp_number?: string | null;
    upi_id?: string | null;
}

export default function Settings() {
    const { user, signOut, refreshProfile } = useAuth();
    const { success, error: showError } = useToast();

    const [fullName, setFullName] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [avatarPreviewUrl, setAvatarPreviewUrl] = useState('');
    const [currency, setCurrency] = useState('₹');
    const [countryIso, setCountryIso] = useState('IN');
    const [whatsappNumber, setWhatsappNumber] = useState('');
    const [upiId, setUpiId] = useState('');
    const [profileLoading, setProfileLoading] = useState(false);
    const [paymentProfileSaving, setPaymentProfileSaving] = useState(false);
    const [paymentProfileLoading, setPaymentProfileLoading] = useState(true);
    const [savedPaymentProfile, setSavedPaymentProfile] = useState<PaymentProfileRow | null>(null);
    const [paymentDetailsEditing, setPaymentDetailsEditing] = useState(true);

    // Password updates removed: unsupported by lightweight auth SDK.

    useEffect(() => {
        if (!avatarFile) {
            setAvatarPreviewUrl('');
            return;
        }
        const previewUrl = URL.createObjectURL(avatarFile);
        setAvatarPreviewUrl(previewUrl);
        return () => URL.revokeObjectURL(previewUrl);
    }, [avatarFile]);

    useEffect(() => {
        if (user) {
            setFullName(user.full_name || '');
            setAvatarUrl(user.avatar_url || '');
            setCurrency(user.currency || '₹');

            let active = true;
            setPaymentProfileLoading(true);
            void dbQuery('user_payment_profiles', `user_id=eq.${user.id}&select=whatsapp_number,upi_id`)
                .then((rows) => {
                    if (!active) return;
                    const paymentProfile = (rows as unknown as PaymentProfileRow[] | undefined)?.[0];
                    const parsedPhone = splitInternationalWhatsAppNumber(paymentProfile?.whatsapp_number);
                    setCountryIso(parsedPhone.countryIso);
                    setWhatsappNumber(parsedPhone.localNumber);
                    setUpiId(paymentProfile?.upi_id || '');
                    setSavedPaymentProfile(paymentProfile || null);
                    setPaymentDetailsEditing(!paymentProfile?.whatsapp_number && !paymentProfile?.upi_id);
                })
                .catch((error) => {
                    console.error('Could not load payment profile', error);
                    if (active) showError('Could not load your saved payment details. Please try again.');
                })
                .finally(() => { if (active) setPaymentProfileLoading(false); });
            return () => { active = false; };
        }
    }, [showError, user]);

    const handleUpdateProfile = async (e: FormEvent) => {
        e.preventDefault();
        if (!user) return;
        setProfileLoading(true);

        let uploadedAvatarReference: string | null = null;
        let avatarWasPersisted = false;
        try {
            let finalAvatarUrl = avatarUrl;

            if (avatarFile) {
                const compressedAvatar = await imageCompression(avatarFile, {
                    maxSizeMB: 0.5,
                    maxWidthOrHeight: 1024,
                    useWebWorker: true,
                });
                const objectPath = `${user.id}/${crypto.randomUUID()}-${safeStorageFileName(compressedAvatar.name || avatarFile.name)}`;
                uploadedAvatarReference = await uploadPrivateFile('avatars', objectPath, compressedAvatar);
                finalAvatarUrl = uploadedAvatarReference;
            }

            await dbUpdate('users', `id=eq.${user.id}`, {
                full_name: fullName,
                avatar_url: finalAvatarUrl,
                currency: currency
            });
            avatarWasPersisted = true;
            setAvatarUrl(finalAvatarUrl);
            setAvatarFile(null);

            if (uploadedAvatarReference && avatarUrl !== uploadedAvatarReference) {
                await deleteStorageReference(avatarUrl).catch((error) => {
                    console.warn('Could not remove the previous Supabase avatar', error);
                });
            }

            // Optionally update auth user meta data as well
            try {
                await insforge.auth.updateUser({
                    data: { full_name: fullName, avatar_url: finalAvatarUrl }
                });
            } catch (err) {
                console.log('Skipping legacy auth profile save', err);
            }

            await refreshProfile();

            success('Profile updated successfully!');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            if (uploadedAvatarReference && !avatarWasPersisted) {
                await deleteStorageReference(uploadedAvatarReference).catch(() => undefined);
            }
            showError(err.message || 'Error updating profile');
        } finally {
            setProfileLoading(false);
        }
    };

    const savePaymentDetails = async () => {
        if (!user) return;
        const normalizedWhatsAppNumber = whatsappNumber.trim()
            ? buildInternationalWhatsAppNumber(countryIso, whatsappNumber)
            : null;
        const normalizedUpiId = upiId.trim() ? normalizeUpiId(upiId) : null;
        if (whatsappNumber.trim() && !normalizedWhatsAppNumber) {
            showError(countryIso === 'IN'
                ? 'Enter a valid 10-digit Indian mobile number beginning with 6, 7, 8, or 9.'
                : 'Enter a valid mobile number without a leading zero.');
            return;
        }
        if (upiId.trim() && !isValidUpiId(upiId)) {
            showError('Enter a valid UPI ID such as yourname@bank.');
            return;
        }

        setPaymentProfileSaving(true);
        try {
            const { data, error } = await insforge.database
                .from('user_payment_profiles')
                .upsert({
                    user_id: user.id,
                    whatsapp_number: normalizedWhatsAppNumber,
                    upi_id: normalizedUpiId,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'user_id' })
                .select('whatsapp_number,upi_id')
                .single();
            if (error) throw new Error(error.message || 'Failed to save payment details');

            const persistedProfile = data as PaymentProfileRow;
            if ((persistedProfile.upi_id || null) !== normalizedUpiId
                || (persistedProfile.whatsapp_number || null) !== normalizedWhatsAppNumber) {
                throw new Error('The saved payment details could not be verified. Please try again.');
            }

            const parsedPhone = splitInternationalWhatsAppNumber(persistedProfile.whatsapp_number);
            setCountryIso(parsedPhone.countryIso);
            setWhatsappNumber(parsedPhone.localNumber);
            setUpiId(persistedProfile.upi_id || '');
            setSavedPaymentProfile(persistedProfile);
            setPaymentDetailsEditing(false);
            window.dispatchEvent(new CustomEvent('splitmate:payment-profile-changed'));
            success('Payment details saved successfully!');
        } catch (error) {
            showError(error instanceof Error ? error.message : 'Failed to save payment details');
        } finally {
            setPaymentProfileSaving(false);
        }
    };

    const cancelPaymentDetailsEdit = () => {
        const parsedPhone = splitInternationalWhatsAppNumber(savedPaymentProfile?.whatsapp_number);
        setCountryIso(parsedPhone.countryIso);
        setWhatsappNumber(parsedPhone.localNumber);
        setUpiId(savedPaymentProfile?.upi_id || '');
        setPaymentDetailsEditing(false);
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
                        <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                            <div className="h-16 w-16 overflow-hidden rounded-full border-2 border-white/10 bg-primary/15">
                                {avatarPreviewUrl ? (
                                    <img src={avatarPreviewUrl} alt="Selected avatar preview" className="h-full w-full object-cover" />
                                ) : avatarUrl ? (
                                    <SecureStorageImage source={avatarUrl} alt="Current avatar" className="h-full w-full object-cover" />
                                ) : (
                                    <div className="grid h-full w-full place-items-center text-xl font-bold text-primary">{fullName.trim().charAt(0).toUpperCase() || '?'}</div>
                                )}
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-white">{avatarFile ? 'New photo selected' : avatarUrl ? 'Current profile photo' : 'No profile photo yet'}</p>
                                <p className="mt-1 text-xs text-muted-foreground">JPG, PNG or WebP. Images are optimized before upload.</p>
                            </div>
                        </div>
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

                        {paymentProfileLoading ? (
                            <div className="grid min-h-28 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                        ) : savedPaymentProfile && !paymentDetailsEditing ? (
                            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <span className="inline-flex items-center gap-2 text-sm font-bold text-emerald-200"><CheckCircle2 className="h-4 w-4" /> Saved payment details</span>
                                    <button type="button" onClick={() => setPaymentDetailsEditing(true)} className="ghost-button inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold"><Pencil className="h-4 w-4" /> Edit WhatsApp & UPI</button>
                                </div>
                                <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div className="rounded-xl bg-black/20 p-3"><dt className="app-label flex items-center gap-2"><MessageCircle className="h-4 w-4 text-emerald-300" /> WhatsApp</dt><dd className="mt-2 break-all font-semibold text-white">{formatInternationalPhone(savedPaymentProfile.whatsapp_number)}</dd></div>
                                    <div className="rounded-xl bg-black/20 p-3"><dt className="app-label flex items-center gap-2"><WalletCards className="h-4 w-4 text-emerald-300" /> UPI ID</dt><dd className="mt-2 break-all font-semibold text-white">{savedPaymentProfile.upi_id || 'Not added'}</dd></div>
                                </dl>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div>
                                    <label className="app-label mb-2 block" htmlFor="profile-whatsapp">WhatsApp number</label>
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
                                        <CountryCodeSelect id="profile-country-code" value={countryIso} onChange={setCountryIso} className="dark-input min-h-11 rounded-lg px-3 text-sm" />
                                        <div className="relative">
                                            <MessageCircle className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                            <input
                                                id="profile-whatsapp"
                                                type="tel"
                                                inputMode="numeric"
                                                autoComplete="tel-national"
                                                value={whatsappNumber}
                                                onChange={(e) => setWhatsappNumber(sanitizeLocalPhoneNumber(e.target.value))}
                                                placeholder="9065440786"
                                                className="dark-input min-h-11 rounded-lg py-2 pl-10 pr-3 text-sm"
                                            />
                                        </div>
                                    </div>
                                    <p className="mt-1 text-[11px] text-muted-foreground">India (+91) is selected by default. Enter the mobile number without a leading zero.</p>
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
                                            className="dark-input min-h-11 rounded-lg py-2 pl-10 pr-3 text-sm"
                                        />
                                    </div>
                                    {upiId.trim() && !isValidUpiId(upiId) ? <p className="mt-1 text-[11px] text-danger">Enter a valid ID such as name@bank.</p> : null}
                                </div>

                                {savedPaymentProfile?.whatsapp_number || savedPaymentProfile?.upi_id ? (
                                    <button type="button" onClick={cancelPaymentDetailsEdit} className="ghost-button inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-xs font-bold"><X className="h-4 w-4" /> Cancel editing</button>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => void savePaymentDetails()}
                                    disabled={paymentProfileSaving}
                                    className="accent-button inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold"
                                >
                                    {paymentProfileSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    Save WhatsApp & UPI
                                </button>
                            </div>
                        )}

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
