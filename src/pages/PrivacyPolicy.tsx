import { useEffect } from "react";

const PrivacyPolicy = () => {
  useEffect(() => {
    document.title = "Privacy Policy - JF Effect";
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0B0F] text-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <img src="/logo.png" alt="JF Effect" className="h-8 w-8" />
            <span className="text-xl font-bold tracking-tight">JF Effect</span>
          </div>
          <h1 className="text-4xl font-bold mb-3">Privacy Policy</h1>
          <p className="text-gray-400">Effective Date: June 1, 2026</p>
        </div>

        <div className="space-y-10 text-gray-300 leading-relaxed">
          {/* Introduction */}
          <section>
            <p>
              JF Effect ("we", "us", or "our") is committed to protecting your privacy. This Privacy Policy 
              explains how we collect, use, and safeguard your personal information when you use the JF Effect 
              mobile app and web platform.
            </p>
          </section>

          {/* Information We Collect */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">Information We Collect</h2>
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-medium text-white mb-2">Account Information</h3>
                <p>Name, email address, and password when you create an account.</p>
              </div>
              <div>
                <h3 className="text-lg font-medium text-white mb-2">Fitness & Health Data</h3>
                <p>
                  Workout logs (exercises, sets, reps, weight, RPE), body measurements, body weight, 
                  progress photos, nutrition data (macros, calories, food logs), and fitness goals.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-medium text-white mb-2">Communication Data</h3>
                <p>Messages between coaches and clients, check-in responses, and form submissions.</p>
              </div>
              <div>
                <h3 className="text-lg font-medium text-white mb-2">Usage Data</h3>
                <p>App activity, session information, and device information for app functionality.</p>
              </div>
            </div>
          </section>

          {/* How We Use Your Information */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">How We Use Your Information</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>Providing and personalizing coaching services</li>
              <li>Enabling communication between coaches and clients</li>
              <li>Tracking fitness progress and program adherence</li>
              <li>Processing payments for coaching services</li>
              <li>Sending notifications about workouts, check-ins, and messages</li>
              <li>Improving app functionality and user experience</li>
            </ul>
          </section>

          {/* Data Storage */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">Data Storage & Security</h2>
            <p>
              Your data is stored securely on cloud servers provided by Supabase (PostgreSQL database) 
              hosted in the United States and Canada. We use industry-standard encryption for data in 
              transit (TLS/HTTPS) and at rest. Progress photos and media files are stored in secure 
              cloud object storage.
            </p>
          </section>

          {/* Third-Party Services */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">Third-Party Services</h2>
            <div className="space-y-3">
              <div className="bg-white/5 rounded-lg p-4">
                <p className="font-medium text-white">Supabase</p>
                <p className="text-sm mt-1">Authentication, database, and file storage. <a href="https://supabase.com/privacy" className="text-blue-400 hover:underline">Privacy Policy</a></p>
              </div>
              <div className="bg-white/5 rounded-lg p-4">
                <p className="font-medium text-white">Stripe</p>
                <p className="text-sm mt-1">Payment processing for coaching subscriptions. <a href="https://stripe.com/privacy" className="text-blue-400 hover:underline">Privacy Policy</a></p>
              </div>
            </div>
          </section>

          {/* Your Rights */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">Your Rights</h2>
            <p className="mb-4">You have the right to:</p>
            <ul className="space-y-2 list-disc list-inside">
              <li>Access your personal data</li>
              <li>Correct inaccurate information</li>
              <li>Request deletion of your account and data</li>
              <li>Export your data in a portable format</li>
              <li>Withdraw consent for data processing</li>
            </ul>
            <p className="mt-4">
              To exercise these rights, contact us at{" "}
              <a href="mailto:support@jfeffect.com" className="text-blue-400 hover:underline">
                support@jfeffect.com
              </a>
            </p>
          </section>

          {/* Data Retention */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">Data Retention</h2>
            <p>
              We retain your data for as long as your account is active. If you delete your account, 
              we will delete your personal data within 30 days, except where retention is required by law.
            </p>
          </section>

          {/* Children */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">Children's Privacy</h2>
            <p>
              JF Effect is not intended for users under 13 years of age. We do not knowingly collect 
              personal information from children under 13.
            </p>
          </section>

          {/* Changes */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of significant 
              changes by email or through the app.
            </p>
          </section>

          {/* Contact */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">Contact Us</h2>
            <div className="bg-white/5 rounded-lg p-6">
              <p className="font-medium text-white mb-2">JF Effect</p>
              <p>Email: <a href="mailto:support@jfeffect.com" className="text-blue-400 hover:underline">support@jfeffect.com</a></p>
              <p className="mt-1">Website: <a href="https://jfeffect.com" className="text-blue-400 hover:underline">jfeffect.com</a></p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
