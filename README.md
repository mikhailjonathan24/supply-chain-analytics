# Supply Chain & Inventory Analytics Dashboard

Dashboard analitik client-side satu layar untuk dataset DataCo. Proyek ini membersihkan dataset dengan Pandas, lalu menampilkan filter, KPI, delapan grafik, matriks pemenuhan regional, dan insight dinamis di browser.

## Struktur

```text
assets/
  css/style.css
  js/script.js
data/
  raw/DataCoSupplyChainDataset.csv      # lokasi yang direkomendasikan
  processed/cleaned_dataco.csv          # dibuat oleh skrip cleaning
scripts/data_cleaning.py
index.html
requirements.txt
```

Skrip juga mendukung dataset sumber yang ada di `data/DataCoSupplyChainDataset.csv` (lokasi file awal proyek). Data CSV bersih hanya menyimpan kolom analitik yang diperlukan; informasi pribadi pelanggan tidak disalin.

## Jalankan melalui VS Code

1. Letakkan dataset asli di `data/raw/DataCoSupplyChainDataset.csv`, atau biarkan di `data/DataCoSupplyChainDataset.csv`.
2. Buka terminal di folder proyek. Buat environment virtual (opsional tetapi disarankan), kemudian install dependency:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install -r requirements.txt
   ```

3. Buat file bersih:

   ```powershell
   python scripts/data_cleaning.py
   ```

   Input dan output dapat ditentukan secara eksplisit:

   ```powershell
   python scripts/data_cleaning.py --input "data\raw\DataCoSupplyChainDataset.csv" --output "data\processed\cleaned_dataco.csv"
   ```

4. Di VS Code, install ekstensi **Live Server**, klik kanan `index.html`, lalu pilih **Open with Live Server**. Dashboard fetch file CSV dari URL lokal; jangan membuka HTML dengan `file://`.

Chart.js, PapaParse, dan Tailwind CSS dimuat via CDN, sehingga browser perlu akses internet. Jika file bersih tidak ditemukan atau CDN tidak tersedia, dashboard menampilkan pesan error.

## Metrik dan keterbatasan sumber

- Order dihitung unik berdasarkan `Order Id`; sales dan unit mengikuti baris item. Perbandingan KPI memakai rentang tanggal sebelumnya dengan panjang yang sama.
- On-time delivery dihitung dari order berstatus `Advance shipping` atau `Shipping on time` dibagi semua order terkirim berstatus tepat waktu atau terlambat; `Shipping canceled` dan `Unknown` tidak masuk denominator. Label status sumber dipertahankan di dataset bersih.
- KPI `Stockouts` adalah proxy jumlah order unik berstatus `Canceled` atau dengan `Late_delivery_risk = 1`. Order yang memenuhi kedua kondisi dihitung satu kali; ini bukan pengukuran stockout inventory.
- Kolom sumber `Product Status` dipetakan menjadi flag ketersediaan katalog pada CSV bersih. Flag ini bukan catatan pergerakan stok atau stockout aktual; chart kategori stockout menggunakan proxy order canceled atau late-risk, bukan flag ketersediaan tersebut.
- Supplier tidak tersedia; performa Market digunakan sebagai proxy supplier. Warehouse fisik juga tidak tersedia, sehingga `Market` dipetakan sebagai `warehouse_proxy` untuk mengisi dropdown Warehouse dan matriks.
- Dataset tidak berisi kuantitas/nilai inventori on-hand, biaya logistik, atau warehouse fisik. KPI Total Inventory Value memakai total `Sales` sebagai proxy nilai penjualan; KPI Logistics Cost memakai total `Order Item Total` sebagai proxy net order value. Keduanya bukan nilai inventory/logistik aktual dan diberi label proxy pada dashboard. Matriks berjudul Inventory Levels by Warehouse menampilkan unit terjual berdasarkan kategori × `Market` sebagai proxy warehouse, bukan stok gudang sebenarnya. Filter Warehouse memakai proxy Market yang sama dan memperbarui semua KPI, grafik, serta tabel. Grafik demand memakai unit terjual; grafik logistik per shipping mode memakai `Order Item Total` sebagai proxy nilai order, bukan biaya logistik.
- Grafik bulanan mengagregasi data terfilter ke bulan kalender Jan–Dec (menggabungkan bulan yang sama dari tahun berbeda dalam rentang tanggal terpilih). Combo chart membandingkan unit terjual sebagai proxy inventory dengan jumlah order unik sebagai demand; unit terjual bukan saldo stok. Demand forecast menampilkan enam bulan historis terbaru dan enam bulan proyeksi dari tren linear sederhana tiga bulan terakhir, bukan model terlatih. Delivery time trend juga diringkas per bulan kalender.
- Status pesanan diringkas ke Completed, Pending, Processing, Canceled, dan Review. Stockout Risk by Category menghitung order unik canceled atau late-risk tinggi pada kategori produk sebagai proxy, bukan kejadian stockout inventori yang terukur.
- Dashboard memakai preprocessing Pandas dan rendering JavaScript di browser.

Dashboard dirancang tanpa scrollbar halaman. Pada layar kecil, panel tetap satu layar dan semua komponen dipadatkan; gunakan monitor desktop untuk keterbacaan terbaik.
