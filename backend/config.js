// Конфигурация приложения
module.exports = {
  // Бесплатный тестовый период (в днях)
  FREE_TRIAL_DAYS: 7,
  
  // Лимит трафика для бесплатного периода (в ГБ)
  FREE_TRIAL_TRAFFIC_GB: 10,
  
  // Планы подписок
  PLANS: {
    FREE_TRIAL: {
      name: 'Бесплатный тестовый период',
      price: 0,
      duration_days: 7,
      traffic_gb: 10
    }
  }
}
