/**
 * Yandex.Cloud Compute Image API — каталог образов для boot-диска.
 *
 * Публичные образы лежат в специальной папке `standard-images`. Каждый образ
 * имеет family (например "ubuntu-2204-lts") — для последней версии семейства
 * есть отдельный endpoint /images:latestByFamily.
 */
const COMPUTE_BASE = 'https://compute.api.cloud.yandex.net/compute/v1'
const STANDARD_IMAGES_FOLDER = 'standard-images'

/**
 * Популярные семейства образов для UI-пресетов.
 * Юзер выбирает семейство → бэкенд резолвит в конкретный imageId через /images:latestByFamily.
 */
const POPULAR_FAMILIES = [
  { family: 'ubuntu-2404-lts',         label: 'Ubuntu 24.04 LTS',     defaultUser: 'ubuntu' },
  { family: 'ubuntu-2204-lts',         label: 'Ubuntu 22.04 LTS',     defaultUser: 'ubuntu' },
  { family: 'ubuntu-2004-lts',         label: 'Ubuntu 20.04 LTS',     defaultUser: 'ubuntu' },
  { family: 'debian-12',               label: 'Debian 12',            defaultUser: 'debian' },
  { family: 'debian-11',               label: 'Debian 11',            defaultUser: 'debian' },
  { family: 'centos-stream-9',         label: 'CentOS Stream 9',      defaultUser: 'centos' },
  { family: 'rocky-linux-9',           label: 'Rocky Linux 9',        defaultUser: 'rocky' },
  { family: 'almalinux-9',             label: 'AlmaLinux 9',          defaultUser: 'almalinux' },
  { family: 'fedora-39',               label: 'Fedora 39',            defaultUser: 'fedora' },
]

/**
 * Получить последний образ в семействе из папки standard-images.
 */
async function getLatestByFamily(yc, family, { folderId = STANDARD_IMAGES_FOLDER } = {}) {
  const r = await yc.get(`${COMPUTE_BASE}/images:latestByFamily`, {
    params: { folderId, family },
  })
  return r.data
}

/**
 * Список образов в папке (по дефолту — публичные стандартные).
 * pageSize: до 1000.
 */
async function listImages(yc, { folderId = STANDARD_IMAGES_FOLDER, pageSize = 200, family } = {}) {
  const r = await yc.get(`${COMPUTE_BASE}/images`, {
    params: { folderId, pageSize },
  })
  let imgs = r.data?.images || []
  if (family) imgs = imgs.filter(i => i.family === family)
  return {
    images: imgs.map(i => ({
      id: i.id,
      name: i.name,
      family: i.family,
      description: i.description,
      status: i.status,
      minDiskSize: i.minDiskSize ? Number(i.minDiskSize) : null,
      productIds: i.productIds || [],
      createdAt: i.createdAt,
    })),
  }
}

module.exports = {
  POPULAR_FAMILIES,
  getLatestByFamily,
  listImages,
  STANDARD_IMAGES_FOLDER,
}
