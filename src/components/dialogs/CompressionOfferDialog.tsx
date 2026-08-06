import { FileArchive } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { usePersistenceStore } from '@/store/persistence-store';
import { COMPRESSION_THRESHOLD_BYTES } from '@/storage/format';

/**
 * Oferta de `.pmz` acima de 5 MB — docs/06-persistencia-e-concorrencia.md §3.
 *
 * "Oferece" é literal: quem decide é o usuário. O `.json` continua sendo o
 * padrão porque é legível e diffável pelo histórico do SharePoint; o `.pmz` é
 * o mesmo JSON com gzip, e a leitura reconhece os dois pelo conteúdo, não
 * pela extensão.
 */
export function CompressionOfferDialog() {
  const offer = usePersistenceStore((s) => s.compressionOffer);
  const chooseFormat = usePersistenceStore((s) => s.chooseFormat);

  if (offer === null) return null;

  const megabytes = (offer.bytes / (1024 * 1024)).toFixed(1);
  const threshold = (COMPRESSION_THRESHOLD_BYTES / (1024 * 1024)).toFixed(0);

  return (
    <Dialog open onOpenChange={(next) => !next && void chooseFormat('json')}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" aria-hidden />
            Este documento passou de {threshold} MB
          </DialogTitle>
          <DialogDescription>
            Em .json ele ocupa {megabytes} MB. Compactado (.pmz) costuma ficar de 8 a 12 vezes
            menor — é o mesmo conteúdo, só que em gzip, e a aplicação reconhece os dois formatos ao
            abrir. Em compensação, o .json é legível e diffável no histórico de versões do
            SharePoint.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="secondary" onClick={() => void chooseFormat('json')}>
            Manter .json
          </Button>
          <Button onClick={() => void chooseFormat('pmz')}>Salvar compactado (.pmz)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
