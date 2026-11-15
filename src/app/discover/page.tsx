import type { Metadata } from "next";
import Link from "next/link";

const origin = process.env.NEXT_PUBLIC_SITE_URL
  ? process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "";

export const metadata: Metadata = {
  title: "Aramco Oil: لعبة تعدين النفط وجمع العملات على تيليجرام",
  description: "العب Aramco Oil، لعبة محاكاة تعدين وضخ النفط على Telegram. اجمع العملات الافتراضية، أكمل المهام اليومية، طوّر المضخة والمعدات، ونافس اللاعبين في الساحة.",
  alternates: { canonical: "/discover" },
  keywords: [
    "لعبة تعدين النفط", "لعبة تعدين تيليجرام", "ألعاب تيليجرام",
    "لعبة جمع العملات", "لعبة عملات افتراضية", "لعبة ضخ النفط",
    "Telegram mining game", "Telegram crypto game", "tap to earn",
    "oil pump simulator", "virtual coin game",
  ],
  openGraph: {
    title: "Aramco Oil – لعبة محاكاة تعدين النفط على تيليجرام",
    description: "اضخ النفط الافتراضي، اجمع العملات، أكمل المهام وطوّر معداتك في لعبة Aramco Oil.",
    type: "website",
    locale: "ar_EG",
    siteName: "Aramco Oil",
    url: origin ? `${origin}/discover` : undefined,
  },
};

const faqs = [
  { q: "ما هي لعبة Aramco Oil؟", a: "Aramco Oil لعبة ترفيهية تعمل كتطبيق مصغر داخل تيليجرام، وتحاكي ضخ النفط وجمع العملات الافتراضية وتطوير المعدات." },
  { q: "هل Aramco Oil تعدين حقيقي للعملات الرقمية؟", a: "لا. اللعبة محاكاة ترفيهية؛ النفط والعملات والأرصدة المعروضة داخلها عناصر افتراضية، ولا تعني تعدينًا فعليًا على البلوكشين أو عائدًا ماليًا مضمونًا." },
  { q: "كيف أتقدم داخل اللعبة؟", a: "ابدأ بالضخ، ثم أكمل المهام اليومية، واجمع العملات الافتراضية، وطوّر المضخة والمعدات، وشارك في التحديات والساحة." },
  { q: "هل يمكن تشغيل Aramco Oil من الهاتف؟", a: "نعم، صُممت التجربة لتعمل داخل Telegram على الهواتف، كما يمكن فتحها من متصفح متوافق." },
  { q: "هل أحتاج إلى تنزيل تطبيق مستقل؟", a: "تعمل اللعبة كتطبيق Telegram Mini App عند فتح رابط اللعبة من تيليجرام، ولا تتطلب تثبيت تطبيق منفصل." },
];

const schema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "VideoGame",
      name: "Aramco Oil",
      alternateName: ["AramcoOil", "لعبة أرامكو أويل", "لعبة تعدين النفط"],
      description: "لعبة محاكاة ترفيهية على تيليجرام تتيح ضخ النفط الافتراضي وجمع العملات وإكمال المهام وتطوير المعدات.",
      gamePlatform: ["Telegram", "Web browser", "Mobile"],
      applicationCategory: "GameApplication",
      genre: ["Simulation", "Casual Game", "Idle Game"],
      inLanguage: ["ar", "en", "ru"],
      isAccessibleForFree: true,
      url: origin ? `${origin}/discover` : "/discover",
    },
    {
      "@type": "SoftwareApplication",
      name: "Aramco Oil",
      applicationCategory: "GameApplication",
      operatingSystem: "Web, Telegram",
      description: "Telegram mini app game for virtual oil pumping, coin collection, missions and equipment upgrades.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      url: origin ? `${origin}/discover` : "/discover",
    },
    {
      "@type": "FAQPage",
      mainEntity: faqs.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
  ],
};

export default function DiscoverPage() {
  return (
    <main dir="rtl" className="min-h-screen bg-[#120d07] text-amber-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
      <div className="mx-auto max-w-4xl px-5 py-14 sm:py-20">
        <header className="mb-14 text-center">
          <p className="mb-4 text-sm font-bold tracking-widest text-amber-400">TELEGRAM MINI APP · OIL SIMULATION GAME</p>
          <h1 className="text-4xl font-black leading-tight sm:text-6xl">Aramco Oil</h1>
          <h2 className="mt-4 text-xl font-extrabold leading-relaxed text-amber-200 sm:text-2xl">لعبة محاكاة تعدين النفط وجمع العملات على تيليجرام</h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-amber-100/70">
            ادخل عالم Aramco Oil، واضخ النفط الافتراضي، واجمع العملات داخل اللعبة، وأكمل المهام اليومية، وطوّر معداتك لتبني تجربة لعبك خطوة بخطوة.
          </p>
          <Link href="/" className="mt-8 inline-flex rounded-2xl bg-gradient-to-l from-amber-400 to-orange-500 px-8 py-4 text-lg font-black text-[#211506] shadow-xl transition hover:scale-[1.02]">
            افتح اللعبة الآن
          </Link>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          {[
            ["🛢️", "ضخ النفط", "اضغط على المضخة واجمع وحدات النفط الافتراضية وراقب سعة التخزين ومعدل الإنتاج."],
            ["🪙", "جمع العملات", "حوّل تقدمك داخل اللعبة إلى عملات افتراضية واستخدمها ضمن أنشطة اللعبة المتاحة."],
            ["⚙️", "تطوير المعدات", "طوّر المضخة ومحطة الوقود والشاحنة لتحسين خصائص الإنتاج داخل المحاكاة."],
            ["🎯", "المهام والتحديات", "أكمل المهام اليومية وشارك في التحديات والساحة وتابع ترتيب اللاعبين."],
          ].map(([icon, title, desc]) => (
            <article key={title} className="rounded-3xl border border-amber-300/15 bg-white/[.04] p-6">
              <span className="text-3xl" aria-hidden="true">{icon}</span>
              <h3 className="mt-3 text-xl font-black text-amber-200">{title}</h3>
              <p className="mt-2 text-sm leading-7 text-amber-50/65">{desc}</p>
            </article>
          ))}
        </section>

        <section className="mt-14 rounded-3xl border border-amber-300/15 bg-white/[.04] p-6 sm:p-8">
          <h2 className="text-2xl font-black text-amber-200">كيف تبدأ اللعب؟</h2>
          <ol className="mt-5 list-inside list-decimal space-y-3 text-sm leading-7 text-amber-50/75">
            <li>افتح Aramco Oil من زر تشغيل اللعبة.</li>
            <li>اختر لغتك وأكمل خطوات البداية.</li>
            <li>ابدأ ضخ النفط واجمع العملات الافتراضية.</li>
            <li>نفّذ المهام وطوّر المعدات وافتح خصائص لعب إضافية.</li>
            <li>تابع التحديات وترتيبك وتقدمك داخل اللعبة.</li>
          </ol>
        </section>

        <section className="mt-14">
          <h2 className="text-2xl font-black text-amber-200">الأسئلة الشائعة عن Aramco Oil</h2>
          <div className="mt-5 space-y-3">
            {faqs.map((item) => (
              <details key={item.q} className="group rounded-2xl border border-amber-300/15 bg-white/[.04] p-5">
                <summary className="cursor-pointer list-none font-bold text-amber-100">{item.q}</summary>
                <p className="mt-3 text-sm leading-7 text-amber-50/65">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <aside className="mt-12 rounded-2xl border border-amber-300/10 bg-black/30 p-5 text-xs leading-7 text-amber-100/55">
          تنبيه: Aramco Oil تجربة ألعاب ومحاكاة ترفيهية. النفط والعملات والأرصدة داخل اللعبة افتراضية، ولا تمثل تعدينًا حقيقيًا أو استثمارًا أو وعدًا بأرباح أو عائد مالي مضمون. اسم اللعبة لا يعني وجود ارتباط رسمي بشركة أرامكو السعودية.
        </aside>

        <footer className="mt-10 border-t border-white/10 pt-6 text-center text-xs text-amber-100/40">
          © {new Date().getFullYear()} Aramco Oil · Telegram oil simulation game
        </footer>
      </div>
    </main>
  );
}
