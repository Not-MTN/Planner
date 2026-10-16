import { GlobeIcon } from '../icons';
import { t } from '../i18n';
import { classPlayerSource } from '../learning';

export function ClassVideoPlayer({ videoUrl, title }: { videoUrl: string; title: string }) {
  const source = classPlayerSource(videoUrl);
  if (!source) {
    return (
      <div className="learning-card-actions">
        <a className="btn btn-outline btn-small" href={videoUrl} target="_blank" rel="noopener noreferrer">
          <GlobeIcon size={14} /> {t('Open video lesson')}
        </a>
        <span className="learning-meta">{t('This video link opens on its video site.')}</span>
      </div>
    );
  }

  return (
    <>
      <div className="class-video-player">
        {source.kind === 'video' ? (
          // Caption tracks belong to the externally hosted media; Planner never uploads or stores video assets.
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video controls preload="metadata" playsInline src={source.src} aria-label={title}>
            {t('Your browser cannot play this video.')}
          </video>
        ) : (
          <iframe
            src={source.src}
            title={title}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
      </div>
      <div className="learning-card-actions">
        <a className="btn btn-outline btn-small" href={videoUrl} target="_blank" rel="noopener noreferrer">
          <GlobeIcon size={14} /> {t('Open video lesson')}
        </a>
      </div>
    </>
  );
}
