import logging
import os
import boto3
from botocore.exceptions import ClientError

REGION = os.environ['REGION']

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ec2 = boto3.client('ec2', region_name=REGION)

def delete_instances(InstanceId):
    """Function to delete the Instance IDs from forensic AWS account."""
    logger.info('Attempting to delete instance {}...' .format(InstanceId))
    try:
        response = ec2.terminate_instances(
            InstanceIds=[
                InstanceId
            ],
            DryRun=False
        )
        logger.info('{} has been successfully deleted.' .format(InstanceId))
    except Exception as exception_handle:
        logger.error(exception_handle)


def lambda_handler(event, context):
    InstanceId = event['InstanceId']
    delete_instances(InstanceId)
