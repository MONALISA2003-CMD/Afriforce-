import './globals.css';

export const metadata = {
  title: 'Afriforce — Powering Africa\u2019s Human Potential',
  description: 'Turn your skills, time and ideas into real economic opportunity.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
