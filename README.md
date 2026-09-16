# CompanyTree

Tarayıcıda çalışan, tek sayfalık, şifreli bir organizasyon şeması editörü.
Kurumsal yapını çiz, kaydet, PDF/Excel çıktı al — hepsi kendi bilgisayarında,
sunucuya veri göndermeden.

**Recep Özmen** tarafından yazıldı. MIT lisansı ile dağıtılmıştır — özgürce
kullanabilirsin, tek isteği kopyalarda telif satırının kalması.

---

## Öne çıkanlar

- **Deterministik yerleşim.** Tidy-tree (Reingold–Tilford) algoritmasıyla,
  yatay + dikey (stacked) modlar. Aynı veri her zaman aynı görüntüyü verir.
- **Sürükle-bırak yeniden düzenleme.** Herhangi bir kutuyu tut, başka bir
  kutunun üstüne bırak — çocuğu olur. Boş alana bırak — floating kalır,
  sonra tekrar bağlarsın. Kök taşınamaz, döngü oluşturulamaz.
- **AES-256-GCM şifreli kasa.** PBKDF2 (SHA-256, 250 000 tur) ile türetilmiş
  anahtar. Veri sadece senin parolanla açılır; sunucu düz metni görmez.
  15 dakika hareketsizlikte otomatik kilit.
- **Vektörel PDF çıktısı.** Roboto (Unicode) fontu ile Türkçe/uluslararası
  karakter desteği. A3/A4, yatay/dikey, seçilebilir köşede logo.
- **Excel çıktısı.** Sayfa 1: ağacın görseli. Sayfa 2: filtrelenebilir düz
  liste. Sayfa 3: özet istatistikler.
- **Kutu başına görsel.** Her düğüme fotoğraf/logo yükleyebilirsin.
- **Yedek al / geri yükle.** `.rigitree` şifreli dosya olarak dışa aktar.
- **Router yok.** Tek sayfa → Apache/nginx altında rewrite'sız çalışır.

---

## Kurulum (kendi sunucun için)

### 1. Gerekenler
- Node.js 20+ (build için — sunucuda veya kendi bilgisayarında)
- Apache veya nginx (statik dosya sunumu; PHP gerekmez)
- HTTPS (parolalı kasa `crypto.subtle` gerektirir; sadece HTTPS/localhost)

### 2. Klonla ve kur

```bash
git clone https://github.com/Quantre34/company-tree.git
cd company-tree/_source
npm ci
npm run build
```

Build çıktısı `../` (proje kökü) altına yazılır:
```
index.html
assets/*.js, *.css
fonts/Roboto-*.ttf
```

Ayrıca kökte bulunan `logo.png` ve `.htaccess` de canlıya taşınır (isteğe
bağlı — logo eksikse ilk açılışta kullanıcıdan istenir).

### 3. Sunucuya yükle

Doc root'una şu 4 şeyi kopyala:

```
index.html
.htaccess          (yalnızca Apache için — gzip/expire başlıkları)
assets/            (tüm içeriği)
fonts/             (tüm içeriği)
logo.png           (opsiyonel — varsa çıktılarda kullanılır)
```

Örnek — Apache doc root'u `/var/www/html/company-tree/`:

```bash
rsync -av --delete \
  index.html .htaccess logo.png assets/ fonts/ \
  user@sunucu:/var/www/html/company-tree/
```

Alt klasörde de çalışır (`https://intranet/company-tree/`) çünkü Vite
`base: './'` ile relative path'ler kullanılıyor.

### 4. İlk açılış

Tarayıcıda aç. "Yeni Kasa Oluştur" ekranında:
1. **Şirket adı** yaz (üst barda, çıktılarda görünür)
2. **Logo yükle** (opsiyonel — PDF'nin köşesine ve önizlemeye gider)
3. **Parola belirle** (min 8 karakter, iki kez teyit)
4. Şemayı düzenlemeye başla — üst bardan `+ Kök Alt` ile birim ekle, kutulara
   çift tıkla / seç → düzenle, sağ paneli kullan.

---

## Özelleştirme

### Kendi seed verinle başlatmak

Firma özel bir başlangıç durumun varsa, `_source/src/data/seed.local.json`
adında bir dosya oluştur ve içine `OrgDoc` şeması ile veri koy (yapı için
`seed.json` örnek). Dosya `.gitignore`'da olduğu için yalnızca senin
deployment'ında yüklenir; upstream repo'ya karışmaz.

Build sırasında `seed.local.json` varsa varsayılan `seed.json`'un yerine
yüklenir.

### Şirket adı / renk teması / logo

Kurulumdan sonra sağ paneldeki "GLOBAL AYARLAR" kartından değiştirebilirsin:
- Kuruluş adı, şema başlığı
- Ana renk, vurgu rengi, kanvas arka rengi, bağlantı çizgi rengi
- Logo görseli, köşe konumu, genişlik yüzdesi

Bu ayarlar şifreli kasada saklanır, kaynağa dokunmadan kalıcı olur.

---

## Klasör yapısı

```
company-tree/
├── _source/                  ← React + TS + Vite kaynak kodu
│   ├── src/
│   │   ├── components/       ← Canvas, NodeBox, TopBar, Inspector, dialogs, LockScreen, PdfPreview
│   │   ├── layout/           ← Reingold–Tilford yerleşim motoru (saf fonksiyon, test edilebilir)
│   │   ├── store/            ← Zustand tabanlı doküman + undo/redo
│   │   ├── crypto/           ← WebCrypto (AES-GCM + PBKDF2) kasa
│   │   ├── export/           ← PDF (jspdf + svg2pdf.js) + Excel (exceljs)
│   │   ├── data/seed.json    ← Boş şablon
│   │   └── styles/theme.css
│   ├── public/fonts/         ← Roboto TTF (Türkçe için)
│   └── vite.config.ts        ← base:'./' + outDir:'../' → doğrudan Apache root'a build
├── .htaccess                 ← Statik varlıklar için gzip/expire başlıkları
├── LICENSE                   ← MIT
└── README.md
```

---

## Güvenlik notu

Şifreleme, dosyayı/localStorage'ı ele geçiren birine karşı korur. Uygulamayı
açabilen ve parolayı bilen kişi veriyi görür. Rol bazlı çok kullanıcılı erişim
gerekiyorsa arkaya bir sunucu katmanı (izin kontrolü, kim ne kaydetti) koymak
gerekir — bu depoda yer almıyor.

**Parolanı kaybedersen veri kurtarılamaz.** İstemci tarafında türetildiği için
"parola sıfırla" gibi bir yol yok. Yedek al (`⤓ Yedek` butonu) ve parolayı
güvenli tut.

---

## Katkı & lisans

MIT — özgürce fork'la, kullan, dağıt. Sadece telif satırı kopyalarda kalsın.

Hata / öneri / iyileştirme için Issue veya Pull Request aç.

— Recep Özmen
