import type { Metadata } from "next";
import SolanaProvider from "./components/SolanaProvider"; // Using default import
import "./globals.css";
import { AuthProvider } from "./components/AuthProvider";
import WalletAuth from "./components/WalletAuth";

export const metadata: Metadata = {
  title: "Meme Casino",
  description: "Play the Meme",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
    <SolanaProvider>
    <AuthProvider>
        <WalletAuth />
        {children}
    </AuthProvider>
</SolanaProvider>
      </body>
    </html>
  );
}

