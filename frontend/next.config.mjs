/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker uchun: faqat kerakli fayllar bilan mustaqil server yig'iladi
  output: "standalone",
  // "/" -> "/chat" marshrut darajasida (sahifa render qilinmaydi). Aks holda render paytidagi redirect
  // login tekshiruvining "/login" ga yo'naltirishi bilan to'qnashib, desktop ilovada bo'sh ekran qoldirardi.
  async redirects() {
    return [{ source: "/", destination: "/chat", permanent: false }];
  },
};

export default nextConfig;
