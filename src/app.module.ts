import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ServerInfoModule } from './server-info/server-info.module';
import { DownloaderServiceModule } from './downloader/downloader.module';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI!),
    ServerInfoModule,
    DownloaderServiceModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
