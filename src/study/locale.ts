import {t} from '../utils/i18n';
export type StudyText = (key: string) => string;
export const studyText = (locale: 'zh-CN' | 'en'): StudyText => key => t('study.' + key, locale);
